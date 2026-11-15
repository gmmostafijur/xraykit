-- XRayKit — initial schema
-- Run this in the Supabase SQL Editor (project: xraykit).
-- It creates profiles, audits and subscriptions tables with Row Level
-- Security, so every user only sees their own data, and admins see all.

-- ---------------------------------------------------------------- profiles
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  plan text not null default 'free' check (plan in ('free', 'pro')),
  trial_ends_at timestamptz,
  audits_used int not null default 0,
  audits_reset_at date not null default current_date,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------------ audits
create table if not exists public.audits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  handle text not null,
  score int,
  report jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------- subscriptions
create table if not exists public.subscriptions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  status text not null default 'free'
    check (status in ('free', 'trialing', 'active', 'past_due', 'canceled')),
  provider text,
  provider_customer_id text,
  current_period_end timestamptz,
  updated_at timestamptz not null default now()
);

-- --------------------------------------------------------------------- RLS
alter table public.profiles enable row level security;
alter table public.audits enable row level security;
alter table public.subscriptions enable row level security;

-- Helper: true when the signed-in user is an admin.
-- SECURITY DEFINER so the check itself bypasses RLS.
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_admin
  );
$$;

-- profiles: own row only; admins see all
create policy "Users can view their own profile"
  on public.profiles for select using (auth.uid() = id);
create policy "Users can update their own profile"
  on public.profiles for update using (auth.uid() = id);
create policy "Admins can view all profiles"
  on public.profiles for select using (public.is_admin());

-- audits: own rows only; admins see all
create policy "Users can view their own audits"
  on public.audits for select using (auth.uid() = user_id);
create policy "Users can insert their own audits"
  on public.audits for insert with check (auth.uid() = user_id);
create policy "Admins can view all audits"
  on public.audits for select using (public.is_admin());

-- subscriptions: own row only; admins see all
create policy "Users can view their own subscription"
  on public.subscriptions for select using (auth.uid() = user_id);
create policy "Admins can view all subscriptions"
  on public.subscriptions for select using (public.is_admin());

-- Explicit grants (works even when "automatically expose new tables" is off)
grant select, update on public.profiles to authenticated;
grant select, insert on public.audits to authenticated;
grant select on public.subscriptions to authenticated;

-- ------------------------------------------- auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  insert into public.subscriptions (user_id, status)
  values (new.id, 'free')
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
