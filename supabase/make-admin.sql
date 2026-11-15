-- XRayKit — make yourself the admin
-- Run this AFTER you have signed up once on the site with
-- gmmostafijur001@gmail.com (so your profile row exists).
-- It flips is_admin on for your account only.

update public.profiles
set is_admin = true
where email = 'gmmostafijur001@gmail.com';

-- Check it worked (should show one row, is_admin = true):
-- select id, email, plan, is_admin, created_at
-- from public.profiles
-- where email = 'gmmostafijur001@gmail.com';
