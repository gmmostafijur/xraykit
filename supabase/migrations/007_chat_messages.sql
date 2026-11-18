-- 007_chat_messages.sql
-- Run in Supabase SQL Editor, xraykit project. Run AFTER 006.
--
-- WHAT: the on-site live chatbox. Visitors write from any page; the admin
-- answers from Admin -> Messages. No third-party chat service, no key.
--   - A visitor is identified by a random visitor_id stored in their
--     browser (localStorage). No account needed.
--   - Visitors INSERT their own messages only (is_admin forced false).
--   - Visitors READ their own thread through the get_chat() function
--     (SECURITY DEFINER, filtered by visitor_id) — no open select policy,
--     so one visitor can never read another's messages.
--   - The admin reads/replies to everything (is_admin() policies) and
--     marks visitor messages read by setting read_at.

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  visitor_id text not null,
  name text,
  email text,
  body text not null check (char_length(body) <= 2000),
  is_admin boolean not null default false,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

alter table public.chat_messages enable row level security;

-- Visitors can send messages, but never as admin.
create policy "Visitors can send chat messages"
  on public.chat_messages for insert
  with check (is_admin = false);

-- Admins read, reply and mark read.
create policy "Admins can read all chat messages"
  on public.chat_messages for select using (public.is_admin());
create policy "Admins can send chat replies"
  on public.chat_messages for insert
  with check (public.is_admin());
create policy "Admins can mark chat messages read"
  on public.chat_messages for update using (public.is_admin());

grant insert on public.chat_messages to anon, authenticated;
grant select, insert, update on public.chat_messages to authenticated;

-- A visitor's own thread (latest 100, oldest first). SECURITY DEFINER so
-- the anon client can read only the rows matching its visitor_id.
create or replace function public.get_chat(p_visitor_id text)
returns setof public.chat_messages
language sql
security definer
as $$
  select * from public.chat_messages
  where visitor_id = p_visitor_id
  order by created_at asc
  limit 100;
$$;
grant execute on function public.get_chat(text) to anon, authenticated;

-- Admin inbox: one row per visitor, newest message first.
create or replace function public.get_chat_threads()
returns table (
  visitor_id text,
  name text,
  email text,
  last_body text,
  last_at timestamptz,
  unread int,
  total int
)
language sql
security definer
as $$
  select
    m.visitor_id,
    (select m2.name from public.chat_messages m2 where m2.visitor_id = m.visitor_id and m2.name is not null order by m2.created_at desc limit 1),
    (select m2.email from public.chat_messages m2 where m2.visitor_id = m.visitor_id and m2.email is not null order by m2.created_at desc limit 1),
    (select m3.body from public.chat_messages m3 where m3.visitor_id = m.visitor_id order by m3.created_at desc limit 1),
    max(m.created_at),
    count(*) filter (where not m.is_admin and m.read_at is null),
    count(*)
  from public.chat_messages m
  group by m.visitor_id
  order by max(m.created_at) desc;
$$;
grant execute on function public.get_chat_threads() to authenticated;
