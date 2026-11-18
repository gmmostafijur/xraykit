-- 005_custom_plans.sql
-- Run in Supabase SQL Editor, xraykit project. No Edge Function redeploy
-- needed for the table + my_plan() change itself (my_plan is a database
-- function). The ai-audit Edge Function DOES need a redeploy to use the
-- custom audit limit (see supabase/functions/ai-audit/index.ts).
--
-- WHAT: per-user Custom packages, set by the admin from the admin
-- dashboard (Users -> "..." -> Custom service).
--   - Admin sets: price (USD), audits per month, and which features are
--     included (written fixes, thread generator, 7-day plan).
--   - Status 'pending' = price set, not paid yet. The user's account stays
--     Free until the admin marks it paid.
--   - Status 'paid' = admin confirmed payment; profiles.plan becomes
--     'custom' and my_plan() returns the custom audit limit + features.
--   - Status 'cancelled' = withdrawn; plan goes back to 'free' if it was
--     this custom plan.
--
-- my_plan() v2 returns two new fields:
--   audit_limit: 1 for free, 30 for pro, the custom number for custom.
--   features: {fixes, threads, plan7day} — all true for free/pro (their
--     behaviour does not change), the custom toggles for custom.
-- ai-audit and the frontend read audit_limit instead of hardcoding 30/1.

create table if not exists public.custom_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  email text not null,
  amount_usd numeric(10, 2) not null check (amount_usd >= 0),
  audit_limit integer not null check (audit_limit >= 1),
  include_fixes boolean not null default true,
  include_threads boolean not null default true,
  include_plan7day boolean not null default true,
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'cancelled')),
  note text,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

alter table public.custom_plans enable row level security;

-- Admins manage all custom plans; a user sees only their own rows.
create policy "Admins can manage custom plans"
  on public.custom_plans for all using (public.is_admin());
create policy "Users can view their own custom plans"
  on public.custom_plans for select using (auth.uid() = user_id);

grant select, insert, update on public.custom_plans to authenticated;

-- Admins can change a user's plan (needed to flip free -> custom on
-- payment, and custom -> free on revoke). Users keep their own-row update.
create policy "Admins can update profiles"
  on public.profiles for update using (public.is_admin());

-- my_plan() v2: same trial-expiry logic as before, plus custom limits.
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
begin
  select * into p from public.profiles where id = auth.uid();
  if p.id is null then
    return jsonb_build_object(
      'plan', 'free', 'trial_ends_at', null, 'audits_used', 0,
      'audit_limit', 1,
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
      -- Paid plan record is gone: fall back to free rather than a
      -- custom plan with no definition.
      effective := 'free';
      lim := 1;
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
    lim := 30;
    feats := jsonb_build_object('fixes', true, 'threads', true, 'plan7day', true);
  else
    lim := 1;
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
