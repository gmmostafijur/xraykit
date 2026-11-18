// send-welcome — XRayKit welcome email, sent 1 minute after email verification.
//
// Called from auth.html right after verifyOtp succeeds (signup flow only).
// Auth: the caller's Supabase JWT — the email goes ONLY to that user's own
// address, and only if their email is confirmed. Responds 202 at once; the
// 60-second wait + send run in the background via EdgeRuntime.waitUntil,
// so the email still goes out even if the user closes the tab.
//
// Secrets — set in Supabase dashboard -> Edge Functions -> Secrets
// (you type these yourself; they never go in chat or code):
//   GMAIL_USER         - Gmail address that sends the mail
//   GMAIL_APP_PASSWORD - Gmail app password for that account (NOT the normal password)

import { createClient } from "npm:@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@6.9.14";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const WELCOME_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Welcome to XRayKit</title>
</head>
<body style="margin:0; padding:0; background-color:#f4f4f4; font-family:Arial, Helvetica, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f4;">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px; width:100%; background-color:#ffffff; border-radius:12px; overflow:hidden;">
          <tr>
            <td align="center" style="background-color:#0a0a0a; padding:28px 20px 22px 20px;">
              <img src="https://xraykit.vercel.app/logo.png" alt="XRayKit" width="140" style="display:block; width:140px; height:auto; border:0;">
              <p style="margin:14px 0 0 0; color:#ffffff; font-size:13px; letter-spacing:3px; text-transform:uppercase;">X Audit &amp; Thread Generator</p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 36px 8px 36px;">
              <h1 style="margin:0 0 12px 0; color:#0a0a0a; font-size:24px; line-height:1.3;">Welcome to XRayKit &#128075;</h1>
              <p style="margin:0 0 16px 0; color:#333333; font-size:16px; line-height:1.6;">Thank you for creating your account. Your email is verified and you are ready to go.</p>
              <p style="margin:0 0 16px 0; color:#333333; font-size:16px; line-height:1.6;"><strong>What is XRayKit?</strong> XRayKit is the X audit + thread generator built for crypto founders. It scans your profile, scores what matters, and turns the findings into threads your audience actually reads. Your Free plan includes 1 audit a month &mdash; Pro unlocks 30 audits a month, a 3-day free trial, and more.</p>
              <p style="margin:0 0 8px 0; color:#333333; font-size:16px; line-height:1.6;">Your first audit is waiting:</p>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:20px 36px 8px 36px;">
              <a href="https://xraykit.vercel.app/audit.html" style="display:inline-block; background-color:#a3e635; color:#0a0a0a; font-size:16px; font-weight:bold; text-decoration:none; padding:14px 32px; border-radius:8px;">Run your first audit &rarr;</a>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 36px 28px 36px;">
              <p style="margin:0; color:#999999; font-size:13px; line-height:1.6;">Questions? Just reply to this email.</p>
            </td>
          </tr>
          <tr>
            <td align="center" style="background-color:#0a0a0a; padding:20px;">
              <p style="margin:0 0 6px 0; color:#ffffff; font-size:14px; font-weight:bold;">XRayKit</p>
              <p style="margin:0; color:#999999; font-size:13px;">Built for crypto founders &middot; <a href="https://xraykit.vercel.app/" style="color:#a3e635; text-decoration:none;">xraykit</a> &middot; @xraykit</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: CORS });
  }

  const auth = req.headers.get("Authorization") || "";
  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: auth } } },
  );
  const { data: { user }, error } = await sb.auth.getUser();
  if (error || !user || !user.email || !user.email_confirmed_at) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  const email = user.email;
  const task = (async () => {
    try {
      await new Promise((r) => setTimeout(r, 60000)); // 1 minute after verification
      const transporter = nodemailer.createTransport({
        host: "smtp.gmail.com",
        port: 465,
        secure: true,
        auth: {
          user: Deno.env.get("GMAIL_USER"),
          pass: Deno.env.get("GMAIL_APP_PASSWORD"),
        },
      });
      await transporter.sendMail({
        from: `"XRayKit" <${Deno.env.get("GMAIL_USER")}>`,
        to: email,
        subject: "Welcome to XRayKit — your first audit is waiting",
        html: WELCOME_HTML,
      });
      console.log("welcome email sent to", email);
    } catch (e) {
      console.error("welcome email failed for", email, e);
    }
  })();
  EdgeRuntime.waitUntil(task);

  return new Response(JSON.stringify({ ok: true, queued: true }), {
    status: 202,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
});
