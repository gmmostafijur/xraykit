// XRayKit — AI status check (Supabase Edge Function, admin-only).
// Returns whether the ANTHROPIC_AUTH_TOKEN secret is set on the server
// and whether the key still works, using a 1-token call to Coarena.
// The key value is NEVER returned by this function.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "Not logged in" }, 401);

    const sb = createClient(
      Deno.env.get("SUPABASE_URL"),
      Deno.env.get("SUPABASE_ANON_KEY"),
      { global: { headers: { Authorization: auth } } }
    );
    const { data: userData, error: userErr } = await sb.auth.getUser();
    const user = userData && userData.user;
    if (userErr || !user) return json({ error: "Not logged in" }, 401);

    const prof = await sb
      .from("profiles")
      .select("is_admin")
      .eq("id", user.id)
      .single();
    if (!prof.data || !prof.data.is_admin) {
      return json({ error: "Admin only" }, 403);
    }

    const key = Deno.env.get("ANTHROPIC_AUTH_TOKEN");
    if (!key) return json({ configured: false, key_valid: false });

    const r = await fetch("https://coarena.ai/api/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-5-5",
        max_tokens: 1,
        messages: [{ role: "user", content: "hi" }],
      }),
    });
    return json({ configured: true, key_valid: r.ok, status: r.status });
  } catch (e) {
    return json(
      { configured: false, key_valid: false, error: String(e).slice(0, 200) },
      500
    );
  }
});
