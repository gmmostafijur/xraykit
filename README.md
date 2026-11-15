# XRayKit

X audit + thread generator for crypto founders.

Paste an X handle, bio, pinned post and recent posts — get an Audit Score (0–100) across Profile / Content / Engagement / Positioning, top 5 problems with fixes, 5 thread ideas, 1 full thread draft, a 7-day posting plan and bio rewrites.

- **Free:** 1 audit (score + 2 problems)
- **Pro:** $7/month, 30 audits/month — first 3 days free

## This repo (demo)

`index.html` is the client-side demo (landing page, audit form, sample report, admin dashboard preview). It runs on sample data only — no live API key, no backend, nothing is saved.

## Live version (planned)

- Auth + saved audits: Supabase (same stack as MRFolio)
- Audit engine: Claude API, server-side only (key never in frontend code)
- Payments: Lemon Squeezy / Paddle ($7/mo Pro, 3-day free trial)
- Hosting: GitHub Pages + Cloudflare (custom domain, SSL)
