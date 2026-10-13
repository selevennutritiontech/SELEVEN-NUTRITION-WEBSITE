# Creator Programme backend (Cloudflare Worker)

`worker.js` is the only backend. It is already deployed as the Worker `seleven-creatorprogramme`
on Cloudflare; the website and dashboard call it at
`https://seleven-creatorprogramme.s-eleventech.workers.dev`. This copy is unchanged - it lives
here so it is versioned with the website.

## What it needs (set in Cloudflare, not in this file)
- KV namespace binding named `SUBMISSIONS`
- variable/secret `ADMIN_PASSWORD` (the dashboard password)
- optional variable `NOTIFY_WEBHOOK_URL` (only for the applicant status messages)

## Re-deploying after a change
1. dash.cloudflare.com -> Workers & Pages -> `seleven-creatorprogramme`
2. Edit code -> replace everything with the contents of `worker.js` -> Deploy
3. Settings -> Bindings: confirm `SUBMISSIONS` (KV) is attached; Variables: confirm `ADMIN_PASSWORD`

## Endpoints
`POST /submit` (public application) - `GET /data`, `POST /update`, `POST /delete`, `POST /notify` (need the admin password)
