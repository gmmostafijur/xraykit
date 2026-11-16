// XRayKit — Paddle Billing webhook
// Receives subscription events from Paddle and mirrors the subscription
// state into public.subscriptions + public.profiles, so a paid customer
// gets Pro (30 audits/mo) and a cancelled / lapsed one drops back to Free.
//
// How it works
// - Paddle signs every delivery with a `Paddle-Signature` header:
//   `ts=<unix>;h1=<hex>`, where h1 is HMAC-SHA256 over "ts:rawBody",
//   keyed with the notification destination secret. We verify against
//   the RAW body (never a re-serialised object) and reject replays
//   older than 5 minutes.
// - The checkout passes the Supabase user id as customData.userId, so
//   subscription.created binds the Paddle customer to the right user.
//   Events without customData fall back to provider_customer_id lookup.
// - Paddle trial (3 days, card on file) is configured on the PRICE in
//   the Paddle dashboard, not in this code.
//
// Secrets (Supabase → Edge Functions → Secrets):
//   PADDLE_WEBHOOK_SECRET — the notification destination secret (pdl_ntfset_...)
//   SERVICE_ROLE_KEY — the new secret API key (sb_secret_...) copied
//     from Settings → API → Secret keys, set as a custom secret. Preferred:
//     the auto-provided SUPABASE_SERVICE_ROLE_KEY is DEPRECATED and no
//     longer carries service-role privileges (2026-11-16: webhook upserts
//     failed with Postgres 42501 insufficient_privilege because of it).
//     NOTE: custom secret names may NOT start with the SUPABASE_ prefix,
//     so the name is SERVICE_ROLE_KEY, not SUPABASE_SERVICE_KEY.
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY — auto-provided by Supabase
//
// Paddle dashboard → Developer tools → Notifications → Add destination:
//   URL: https://elbddcclcmmpqdxsdahg.supabase.co/functions/v1/smooth-api
//   (deployed slug is "smooth-api", not "paddle-webhook")
//   Events: subscription.created, subscription.activated, subscription.updated,
//           subscription.canceled, subscription.past_due, subscription.paused,
//           subscription.resumed

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const WEBHOOK_SECRET = Deno.env.get("PADDLE_WEBHOOK_SECRET") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY =
  Deno.env.get("SERVICE_ROLE_KEY") ||
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const SIGNATURE_MAX_AGE_SECONDS = 300; // 5 minutes — replay protection

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function toHex(buf) {
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hmacHex(secret, data) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(data),
  );
  return toHex(sig);
}

// Constant-time string comparison (avoids leaking the hash via timing).
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function verifySignature(rawBody, header) {
  if (!WEBHOOK_SECRET || !header) return false;
  const parts = header.split(";").map((s) => s.trim());
  let ts = null;
  const h1s = [];
  for (const p of parts) {
    if (p.startsWith("ts=")) ts = p.slice(3);
    else if (p.startsWith("h1=")) h1s.push(p.slice(3));
  }
  if (!ts || h1s.length === 0) return false;
  const tsNum = parseInt(ts, 10);
  if (Number.isNaN(tsNum)) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - tsNum) > SIGNATURE_MAX_AGE_SECONDS) return false;
  const expected = await hmacHex(WEBHOOK_SECRET, ts + ":" + rawBody);
  return h1s.some((h) => timingSafeEqual(h.toLowerCase(), expected));
}

// Paddle status -> our subscriptions.status check values
// ('free','trialing','active','past_due','canceled').
// 'paused' has no matching value: map to 'past_due' (access off;
// a resume flips it back to active).
const STATUS_MAP = {
  active: "active",
  trialing: "trialing",
  past_due: "past_due",
  canceled: "canceled",
  paused: "past_due",
};

async function handleSubscription(eventType, sub) {
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  const paddleStatus = String(sub.status || "");
  const mapped = STATUS_MAP[paddleStatus];
  if (!mapped) {
    console.error("paddle-webhook: unknown subscription status " + paddleStatus);
    return;
  }

  // 1) Find the user: customData.userId first, provider_customer_id fallback.
  let userId =
    sub.custom_data && typeof sub.custom_data.userId === "string"
      ? sub.custom_data.userId
      : null;
  if (!userId && sub.customer_id) {
    const { data: row } = await sb
      .from("subscriptions")
      .select("user_id")
      .eq("provider_customer_id", sub.customer_id)
      .maybeSingle();
    if (row) userId = row.user_id;
  }
  if (!userId) {
    // Acknowledge (200) anyway — Paddle retries non-2xx for days.
    console.error(
      "paddle-webhook: no user for subscription " + (sub.id || "?") +
        " (customer " + (sub.customer_id || "?") + ")",
    );
    return;
  }

  const periodEnd =
    (sub.current_billing_period && sub.current_billing_period.ends_at) ||
    sub.next_billed_at ||
    null;
  const trialEnd =
    sub.trial_period_end ||
    (sub.items && sub.items[0] && sub.items[0].trial_dates &&
      sub.items[0].trial_dates.ends_at) ||
    null;
  const sched = sub.scheduled_change || null;
  const cancelAt =
    sched && sched.action === "cancel" ? sched.effective_at : null;
  const cancelFuture = cancelAt
    ? new Date(cancelAt).getTime() > Date.now()
    : false;

  // 2) Mirror the subscription row.
  const { error: upErr } = await sb.from("subscriptions").upsert({
    user_id: userId,
    status: mapped,
    provider: "paddle",
    provider_customer_id: sub.customer_id || null,
    current_period_end: periodEnd || cancelAt || null,
    updated_at: new Date().toISOString(),
  });
  if (upErr) {
    console.error("paddle-webhook: subscriptions upsert failed", upErr);
    throw new Error("subscriptions upsert failed");
  }

  // 3) Set the effective plan. my_plan() flips pro -> free when the trial
  // has expired and the subscription is not 'active', so for the two
  // delayed cases below we park the "pro until" date in trial_ends_at.
  if (mapped === "active" || mapped === "trialing") {
    const patch = { plan: "pro" };
    if (mapped === "trialing" && trialEnd) patch.trial_ends_at = trialEnd;
    const { error } = await sb.from("profiles").update(patch).eq("id", userId);
    if (error) console.error("paddle-webhook: profiles update failed", error);
  } else if (mapped === "canceled") {
    if (cancelFuture) {
      // Cancelled at end of period: keep Pro until then.
      const { error } = await sb
        .from("profiles")
        .update({ plan: "pro", trial_ends_at: cancelAt })
        .eq("id", userId);
      if (error) console.error("paddle-webhook: profiles update failed", error);
    } else {
      const { error } = await sb
        .from("profiles")
        .update({ plan: "free" })
        .eq("id", userId);
      if (error) console.error("paddle-webhook: profiles update failed", error);
    }
  } else if (mapped === "past_due") {
    // Dunning grace: keep Pro until the paid period ends. If the payment
    // recovers the next event flips it back to active; if not, my_plan
    // flips it to free once the period end passes.
    if (periodEnd) {
      const { error } = await sb
        .from("profiles")
        .update({ trial_ends_at: periodEnd })
        .eq("id", userId);
      if (error) console.error("paddle-webhook: profiles update failed", error);
    }
  }

  console.log(
    "paddle-webhook: " + eventType + " " + (sub.id || "") +
      " -> " + mapped + " user " + userId,
  );
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return json({ error: "method not allowed" }, 405);
  }
  // Read the RAW body first — signature verification needs the exact bytes.
  const rawBody = await req.text();
  const sig =
    req.headers.get("Paddle-Signature") ||
    req.headers.get("paddle-signature") ||
    "";
  if (!(await verifySignature(rawBody, sig))) {
    console.error("paddle-webhook: bad signature");
    return json({ error: "invalid signature" }, 401);
  }
  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return json({ error: "bad json" }, 400);
  }
  const type = event.event_type || "";
  const data = event.data || {};
  if (!type.startsWith("subscription.")) {
    console.log("paddle-webhook: ignoring " + type);
    return json({ ok: true, ignored: type });
  }
  try {
    await handleSubscription(type, data);
  } catch (e) {
    console.error("paddle-webhook: handler failed", e);
    return json({ error: "handler failed" }, 500);
  }
  return json({ ok: true });
});
