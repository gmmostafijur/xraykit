-- XRayKit — secure 3-day free trial
-- Run in the Supabase SQL Editor AFTER 001_init.sql.
--
-- Security note: the trial is started by a SECURITY DEFINER function, NOT by
-- letting the browser write plan='pro' on its own profile row. The broad
-- "users can update their own profile" policy is dropped below, so nobody
-- can grant themselves Pro or admin from the client.

-- 1) Close the hole: no direct profile updates from the client.
drop policy if exists "Users can update their own profile" on public.profiles;

-- 2) Start a free trial: one trial per account, 3 days, no card.
create or replace function public.start_free_trial()
returns jsonb
language plpgsql
security definer
as $$
declare
  p public.profiles%rowtype;
  ends_at timestamptz;
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
  ends_at := now() + interval '3 days';
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

-- 3) Effective plan: an expired trial flips back to Free by itself.
-- (A paid subscription with status 'active' keeps Pro even after the trial date.)
create or replace function public.my_plan()
returns jsonb
language plpgsql
security definer
as $$
declare
  p public.profiles%rowtype;
  s public.subscriptions%rowtype;
  effective text;
begin
  select * into p from public.profiles where id = auth.uid();
  if p.id is null then
    return jsonb_build_object('plan', 'free', 'trial_ends_at', null, 'audits_used', 0);
  end if;
  select * into s from public.subscriptions where user_id = auth.uid();
  effective := p.plan;
  if p.plan = 'pro' and p.trial_ends_at is not null and p.trial_ends_at < now()
     and (s.status is null or s.status <> 'active') then
    effective := 'free';
    update public.profiles set plan = 'free' where id = auth.uid();
    update public.subscriptions set status = 'free', updated_at = now() where user_id = auth.uid();
  end if;
  return jsonb_build_object('plan', effective, 'trial_ends_at', p.trial_ends_at, 'audits_used', p.audits_used);
end;
$$;
grant execute on function public.my_plan() to authenticated;
