-- 006_site_settings.sql
-- Run in Supabase SQL Editor, xraykit project. Run AFTER 005.
--
-- WHAT: site-wide settings the admin edits from the admin dashboard
-- (Admin -> Settings). Prices, trial length, audit limits and feature
-- switches become real database values instead of hardcoded numbers.
--   - Public read: prices / trial / features are shown on the public site.
--   - Only admins can write (is_admin()).
--   - my_plan() v3 reads free/pro audit limits from here (custom limits
--     still come from custom_plans, 005).
--   - start_free_trial() v2 reads trial_days from here (was hardcoded 3).
-- The ai-audit Edge Function needs NO redeploy for this: it already reads
-- planRow.audit_limit from my_plan().

create table if not exists public.site_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.site_settings enable row level security;

create policy "Anyone can read site settings"
  on public.site_settings for select using (true);
create policy "Admins can manage site settings"
  on public.site_settings for all using (public.is_admin());

grant select on public.site_settings to anon, authenticated;
grant insert, update, delete on public.site_settings to authenticated;

insert into public.site_settings (key, value) values
  ('pro_price_usd', '7'),
  ('trial_days', '3'),
  ('free_audit_limit', '1'),
  ('pro_audit_limit', '30'),
  ('signups_paused', 'false'),
  ('gemini_input_usd_per_million', 'null'),
  ('gemini_output_usd_per_million', 'null'),
  ('features', '{"ai_image": true, "hashtags": true, "auto_posting": false, "tracker": true, "history": true, "compare": true, "scheduler": true, "custom_packages": true, "share_card": true}')
on conflict (key) do nothing;

-- my_plan() v3: v2 logic, but free/pro limits come from site_settings.
create or replace function public.my_plan()
returns jsonb
language plpgsql
security definer
as $$
declare
  p public.profiles%rowtype;
  s public.subscriptions%rowtype;
  cp public.custom_plans%rowtype;
  effective text;
  used int;
  lim int;
  feats jsonb;
  free_lim int;
  pro_lim int;
begin
  free_lim := coalesce((select (value)::int from public.site_settings where key = 'free_audit_limit'), 1);
  pro_lim := coalesce((select (value)::int from public.site_settings where key = 'pro_audit_limit'), 30);
  select * into p from public.profiles where id = auth.uid();
  if p.id is null then
    return jsonb_build_object(
      'plan', 'free', 'trial_ends_at', null, 'audits_used', 0,
      'audit_limit', free_lim,
      'features', jsonb_build_object('fixes', true, 'threads', true, 'plan7day', true)
    );
  end if;
  select * into s from public.subscriptions where user_id = auth.uid();
  effective := p.plan;
  if p.plan = 'pro' and p.trial_ends_at is not null and p.trial_ends_at < now()
     and (s.status is null or s.status <> 'active') then
    effective := 'free';
    update public.profiles set plan = 'free' where id = auth.uid();
    update public.subscriptions set status = 'free', updated_at = now() where user_id = auth.uid();
  end if;
  select count(*) into used from public.audits
    where user_id = auth.uid()
      and created_at >= date_trunc('month', now());
  if effective = 'custom' then
    select * into cp from public.custom_plans
      where user_id = auth.uid() and status = 'paid'
      order by paid_at desc nulls last, created_at desc limit 1;
    if cp.id is null then
      effective := 'free';
      lim := free_lim;
      feats := jsonb_build_object('fixes', true, 'threads', true, 'plan7day', true);
    else
      lim := cp.audit_limit;
      feats := jsonb_build_object(
        'fixes', cp.include_fixes,
        'threads', cp.include_threads,
        'plan7day', cp.include_plan7day
      );
    end if;
  elsif effective = 'pro' then
    lim := pro_lim;
    feats := jsonb_build_object('fixes', true, 'threads', true, 'plan7day', true);
  else
    lim := free_lim;
    feats := jsonb_build_object('fixes', true, 'threads', true, 'plan7day', true);
  end if;
  return jsonb_build_object(
    'plan', effective,
    'trial_ends_at', p.trial_ends_at,
    'audits_used', used,
    'audit_limit', lim,
    'features', feats
  );
end;
$$;
grant execute on function public.my_plan() to authenticated;

-- start_free_trial() v2: trial length comes from site_settings.
create or replace function public.start_free_trial()
returns jsonb
language plpgsql
security definer
as $$
declare
  p public.profiles%rowtype;
  ends_at timestamptz;
  days int;
begin
  select * into p from public.profiles where id = auth.uid();
  if p.id is null then
    raise exception 'profile not found';
  end if;
  if p.plan = 'pro' then
    return jsonb_build_object('ok', false, 'reason', 'already_pro');
  end if;
  if p.trial_ends_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'trial_used');
  end if;
  days := coalesce((select (value)::int from public.site_settings where key = 'trial_days'), 3);
  ends_at := now() + (days || ' days')::interval;
  update public.profiles
     set plan = 'pro', trial_ends_at = ends_at,
         audits_used = 0, audits_reset_at = current_date
   where id = auth.uid();
  update public.subscriptions
     set status = 'trialing', updated_at = now()
   where user_id = auth.uid();
  return jsonb_build_object('ok', true, 'trial_ends_at', ends_at);
end;
$$;
grant execute on function public.start_free_trial() to authenticated;
