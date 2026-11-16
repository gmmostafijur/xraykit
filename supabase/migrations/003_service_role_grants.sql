-- 003_service_role_grants.sql
-- XRayKit — grant the service_role explicit CRUD on the tables the Edge
-- Functions write through the service key (paddle-webhook + ai-audit).
-- 2026-11-16: webhook upserts failed with Postgres 42501 (insufficient
-- privilege) until this ran — in this project service_role had NO table
-- privileges by default, even with a valid sb_secret_ key and the new
-- SERVICE_ROLE_KEY code deployed. Run once in the SQL Editor (already run
-- 2026-11-16, "Success. No rows returned"); kept here so a fresh project
-- gets it from migrations.
grant select, insert, update, delete on public.subscriptions to service_role;
grant select, insert, update, delete on public.profiles to service_role;
grant select, insert, update, delete on public.audits to service_role;
