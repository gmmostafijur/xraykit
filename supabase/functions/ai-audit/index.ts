// XRayKit — real AI audit (Supabase Edge Function).
// AI provider: Coarena Model API (Anthropic-compatible).
//   Base URL: https://coarena.ai/api  (SDK adds /v1/messages)
//   Model:    claude-sonnet-5-5
//   Key:      set as the ANTHROPIC_AUTH_TOKEN secret in the Supabase
//             dashboard (Edge Functions -> Manage secrets). NEVER put the
//             key in this file, in chat, or in any frontend page.
// Free plan: 1 audit/month. Pro plan: 30 audits/month.
// The function verifies the caller's Supabase JWT, enforces the limit,
// calls the AI, saves the audit row, and bumps audits_used.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const COARENA_BASE = "https://coarena.ai/api";
const MODEL = "gemini-3-8-flash";
const FREE_LIMIT = 1;
const PRO_LIMIT = 30;
const MAX_TOKENS = 4000;

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function clean(str, max) {
  return String(str || "").trim().slice(0, max);
}

function buildPrompt(input) {
  const posts = (input.posts || []).map(function (p, i) {
    return "Post " + (i + 1) + ": " + clean(p, 1000);
  }).join("\n");
  return [
    "You are XRayKit, an X (Twitter) growth auditor for crypto founders. Audit the account below and return STRICT JSON only — no markdown, no commentary, no code fences.",
    "",
    "Handle: @" + input.handle,
    "Project: " + input.project,
    "Category: " + input.category,
    "Goal: " + input.goal + " (fundraise / community / sales)",
    "Bio: " + clean(input.bio, 500),
    "Pinned post: " + clean(input.pinned, 1000),
    "Recent posts:",
    posts || "(none provided)",
    "",
    "Score the account 0-100 across four dimensions and overall. Be specific and honest: name the exact problem you see in their own words, then the exact fix. Write in plain, direct English a crypto founder would act on. Threads must be ready to post.",
    "",
    "Return exactly this JSON shape:",
    "{",
    '  "score": 59,',
    '  "dimensions": {"profile": 62, "content": 55, "engagement": 48, "positioning": 70},',
    '  "problems": [{"title": "short title, e.g. Bio & positioning", "score": 38, "saw": "quote their own words back, e.g. the bio text", "why": "why this costs them reach, trust or followers", "fix": "the concrete fix, written out", "impact": "high"}, ... exactly 5 items, worst first],',
    '  "strengths": [{"title": "short asset name, e.g. A live testnet", "text": "why this is a real asset and how to use it"}, ... exactly 3 items],',
    '  "threads": [{"hook": "first line of the thread", "angle": "what the thread teaches or proves"}, ... 5 items],',
    '  "fullThread": ["post 1 (hook)", "post 2", "... 7 to 10 posts, each under 280 characters"],',
    '  "bioOptions": ["bio option 1", "bio option 2", "bio option 3"],',
    '  "plan7day": [{"day": "Day 1", "post": "what to post", "why": "why it works"}, ... 7 items]',
    "}",
  ].join("\n");
}

function extractAiText(d) {
  if (!d) return "";
  if (typeof d === "string") return d;
  if (Array.isArray(d.content)) {
    for (const b of d.content) {
      if (b && typeof b.text === "string" && b.text) return b.text;
    }
  }
  if (typeof d.content === "string") return d.content;
  if (Array.isArray(d.choices) && d.choices[0] && d.choices[0].message &&
      typeof d.choices[0].message.content === "string") {
    return d.choices[0].message.content;
  }
  if (typeof d.output_text === "string") return d.output_text;
  return "";
}

function extractJson(text) {
  if (!text) return null;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch (_e) {
    return null;
  }
}

function validReport(r) {
  if (!r || typeof r !== "object") return false;
  if (typeof r.score !== "number") return false;
  if (!Array.isArray(r.problems) || r.problems.length < 1) return false;
  for (const p of r.problems) {
    if (!p || typeof p.title !== "string" || typeof p.saw !== "string" ||
        typeof p.why !== "string" || typeof p.fix !== "string") return false;
    if (typeof p.score !== "number") p.score = 50;
  }
  if (!Array.isArray(r.threads) || r.threads.length < 1) return false;
  if (!Array.isArray(r.fullThread) || r.fullThread.length < 1) return false;
  if (!Array.isArray(r.plan7day) || r.plan7day.length < 1) return false;
  if (!Array.isArray(r.strengths)) r.strengths = [];
  return true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    if (req.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "Not logged in" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const aiKey = Deno.env.get("ANTHROPIC_AUTH_TOKEN");
    if (!supabaseUrl || !anonKey || !serviceKey) {
      return json({ error: "Server not configured" }, 500);
    }
    if (!aiKey) {
      return json({ error: "AI key not configured" }, 500);
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: auth } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    const user = userData && userData.user;
    if (userErr || !user) return json({ error: "Not logged in" }, 401);

    const admin = createClient(supabaseUrl, serviceKey);

    // Authoritative effective plan (handles expired trials) + usage.
    const planRes = await userClient.rpc("my_plan");
    const planRow = planRes.data || {};
    const plan = planRow.plan === "pro" ? "pro" : "free";
    const limit = plan === "pro" ? PRO_LIMIT : FREE_LIMIT;

    const profRes = await admin
      .from("profiles")
      .select("audits_used, audits_reset_at")
      .eq("id", user.id)
      .single();
    const profile = profRes.data || {};
    const now = new Date();
    let auditsUsed = Number(profile.audits_used || 0);
    const resetAt = profile.audits_reset_at
      ? new Date(profile.audits_reset_at)
      : null;
    if (!resetAt || now >= resetAt) {
      auditsUsed = 0;
      const nextReset = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      await admin
        .from("profiles")
        .update({
          audits_used: 0,
          audits_reset_at: nextReset.toISOString(),
        })
        .eq("id", user.id);
    }
    if (auditsUsed >= limit) {
      return json(
        {
          error: "limit_reached",
          plan: plan,
          limit: limit,
          audits_used: auditsUsed,
        },
        402
      );
    }

    const input = await req.json();
    const handle = clean(input.handle, 50).replace(/^@/, "");
    if (!handle) return json({ error: "X handle is required" }, 400);
    const goal = ["fundraise", "community", "sales"].includes(input.goal)
      ? input.goal
      : "community";
    const payload = {
      handle: handle,
      project: clean(input.project, 120),
      category: clean(input.category, 80),
      goal: goal,
      bio: clean(input.bio, 500),
      pinned: clean(input.pinned, 1000),
      posts: Array.isArray(input.posts)
        ? input.posts.slice(0, 5).map(function (p) { return clean(p, 1000); })
        : [],
    };

    const aiRes = await fetch(COARENA_BASE + "/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": aiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        messages: [{ role: "user", content: buildPrompt(payload) }],
      }),
    });
    if (!aiRes.ok) {
      const detail = await aiRes.text();
      return json(
        { error: "AI provider error", detail: detail.slice(0, 300) },
        502
      );
    }
    const aiRaw = await aiRes.text();
    let aiData = null;
    try {
      aiData = JSON.parse(aiRaw);
    } catch (_e) {
      return json({ error: "AI provider error", detail: aiRaw.slice(0, 300) }, 502);
    }
    const text = extractAiText(aiData);
    const report = extractJson(text);
    if (!validReport(report)) {
      console.error("ai-audit: unusable AI report", text.slice(0, 500));
      return json({ error: "AI returned an unusable report" }, 502);
    }
    report.score = Math.max(0, Math.min(100, Math.round(report.score)));
    report.problems.forEach(function (p) {
      p.score = Math.max(0, Math.min(100, Math.round(Number(p.score) || 50)));
      if (!["high", "medium", "low"].includes(p.impact)) p.impact = "medium";
    });
    report.meta = {
      handle: handle,
      project: payload.project,
      category: payload.category,
      goal: payload.goal,
    };
    if (report.dimensions && typeof report.dimensions === "object") {
      Object.keys(report.dimensions).forEach(function (k) {
        const v = Number(report.dimensions[k]);
        report.dimensions[k] = isNaN(v) ? 0 : Math.max(0, Math.min(100, Math.round(v)));
      });
    }

    const ins = await admin
      .from("audits")
      .insert({
        user_id: user.id,
        handle: handle,
        score: report.score,
        report: report,
      })
      .select("id")
      .single();
    if (ins.error || !ins.data) {
      console.error("ai-audit: insert failed", ins.error);
      return json({ error: "Could not save audit", detail: (ins.error && ins.error.message) || "" }, 500);
    }
    await admin
      .from("profiles")
      .update({ audits_used: auditsUsed + 1 })
      .eq("id", user.id);

    return json({
      audit_id: ins.data.id,
      report: report,
      plan: plan,
      limit: limit,
      audits_used: auditsUsed + 1,
    });
  } catch (e) {
    console.error("ai-audit failed", e);
    return json({ error: "Audit failed", detail: String((e && e.message) || e).slice(0, 200) }, 500);
  }
});
