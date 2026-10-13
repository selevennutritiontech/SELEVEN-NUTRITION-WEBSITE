# S-ELEVEN Nutrition website

- `index.html` - main website (single file, images embedded)
- `creator-programme/index.html` - Athlete & Creator Programme page and application form
- `creator-programme/team/index.html` - password-protected team dashboard (not indexed by search engines)
- `backend/worker.js` - Cloudflare Worker that stores applications (deployed on Cloudflare, not on Vercel)
- `vercel.json` - hides `/backend` and this README from the public website
- `assets/images/` - original-quality copies of the pictures (pages do not need them)

Website: GitHub -> Vercel (automatic on every commit).
Backend: Cloudflare Workers - see `backend/README.md`.
