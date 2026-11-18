-- 008_audit_costs.sql
-- Run in Supabase SQL Editor, xraykit project. Run AFTER 007.
--
-- WHAT: real Gemini usage per audit, so the admin dashboard can show
-- per-user and total API cost. The ai-audit Edge Function inserts one row
-- per successful audit with the token counts from the provider response.
-- Cost in $ is computed in the admin dashboard from the prices the admin
-- sets in Settings (site_settings: gemini_input_usd_per_million,
-- gemini_output_usd_per_million) — no price is hardcoded anywhere.
-- Audits from before this migration have no cost row: the dashboard shows
-- their token counts as "not tracked", never a guessed $ figure.
-- RLS: admins read everything, a user reads only their own rows. No
-- client insert policy — only the Edge Function (service key) inserts.

create table if not exists public.audit_costs (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid references public.audits (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  handle text not null,
  model text not null default 'gemini-3-8-flash',
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.audit_costs enable row level security;

create policy "Admins can read all audit costs"
  on public.audit_costs for select using (public.is_admin());
create policy "Users can read their own audit costs"
  on public.audit_costs for select using (auth.uid() = user_id);

grant select on public.audit_costs to authenticated;
