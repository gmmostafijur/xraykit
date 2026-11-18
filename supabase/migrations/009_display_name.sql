-- 009_display_name.sql
-- Run in Supabase SQL Editor, xraykit project. Run AFTER 008.
--
-- WHAT: a display name users can set in My account -> Profile.
--   - profiles.display_name (nullable, max 60 chars enforced by the RPC).
--   - set_display_name() is SECURITY DEFINER and updates ONLY that one
--     column: the client must never be able to write plan / is_admin on
--     its own profile row (that hole was closed in 002 and stays closed).

alter table public.profiles
  add column if not exists display_name text;

create or replace function public.set_display_name(p_name text)
returns jsonb
language plpgsql
security definer
as $$
declare
  v text;
begin
  v := nullif(btrim(coalesce(p_name, '')), '');
  if v is not null and char_length(v) > 60 then
    v := left(v, 60);
  end if;
  update public.profiles set display_name = v where id = auth.uid();
  return jsonb_build_object('ok', true, 'display_name', v);
end;
$$;
grant execute on function public.set_display_name(text) to authenticated;
