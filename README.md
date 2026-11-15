# XRayKit

X audit + thread generator for crypto founders.

Paste an X handle, bio, pinned post and recent posts — get an Audit Score (0–100) across Profile / Content / Engagement / Positioning, top 5 problems with fixes, 5 thread ideas, 1 full thread draft, a 7-day posting plan and bio rewrites.

- **Free:** 1 audit (score + 2 problems)
- **Pro:** $7/month, 30 audits/month — first 3 days free

## Pages (final Step 1–4)

- `index.html` — Step 1: Landing page
- `audit.html` — Step 2: Audit form
- `report.html` — Step 3: Sample report
- `admin.html` — Step 4: Admin dashboard preview

These are the final demo pages. They run on sample data only — no live API key, no backend, nothing is saved.

## Live version (planned)

- Auth + saved audits: Supabase (same stack as MRFolio)
- Audit engine: Claude API, server-side only (key never in frontend code)
- Payments: Lemon Squeezy / Paddle ($7/mo Pro, 3-day free trial)
- Hosting: GitHub Pages + Cloudflare (custom domain, SSL)

## Login (live, Supabase)
- `auth.html` — Log in / Sign up page, wired to the xraykit Supabase project.
- `supabase/migrations/001_init.sql` — profiles, audits, subscriptions tables + RLS. Run in the Supabase SQL Editor.
- `supabase/make-admin.sql` — run after the first signup to make gmmostafijur001@gmail.com the admin.

## Admin dashboard (live)
- `admin.html` — owner-only. Redirects to auth.html when logged out and to the site when the user is not an admin. Live stats (users, MRR, trials, audits, API cost), latest signups, all users, recent audits, abuse (empty until a flag system exists) — all read from Supabase under admin RLS. Settings form is still preview-only; real settings saving arrives with payments.
- `nav-auth.js` — shared header auth state: hides "Log in" and shows "My account" when a session exists (index, audit, report, auth pages).
