# Phone-accessible demo deployment plan

**Status: not deployed.** Nothing below has been done. Each option needs the owner's go-ahead. None needs a paid plan to start.

## Recommended: Vercel Hobby (free tier)

Vercel builds Next.js apps natively, and every deployment gets an HTTPS URL that opens on any phone.

| Step | Who | Cost |
| --- | --- | --- |
| 1. Sign in to vercel.com with GitHub and import `homemailahmed-tech/meta-hospitality-ai` | Owner | Free (Hobby) |
| 2. Pick the branch to deploy (the demo branch or `main` after merge). Framework preset: Next.js. No build settings needed | Owner | Free |
| 3. Environment variables: leave `AI_MODE=simulation` for the first deploy | Owner | Free |
| 4. Open the `*.vercel.app` URL on a phone and run the demo script | Owner | Free |
| 5. After Meta AI approval, add the keys from `docs/ACTIVATE_META_AI.md` in Vercel → Settings → Environment Variables and redeploy | Owner | Meta usage only |

Notes:
- Vercel's Hobby plan is intended for personal, non-commercial projects. A hackathon prototype normally fits, but please confirm against
  Vercel's current terms.
- Anyone with the URL can use the demo. Keep `AI_DAILY_CALL_LIMIT` low (e.g. 50–100) once a Meta key is added. The cap applies
  per server instance, so treat it as a safety net rather than a guarantee. Leave Google Maps disabled.
- Demo state lives in each visitor's browser (localStorage). Visitors cannot see each other's changes, and **Reset demo data** restores it.
- Map tiles come from OpenStreetMap's free tile server. That is fine for a light demo. Switch `tileUrl` to a commercial provider for real traffic.

## Alternative: temporary link from the owner's laptop (no hosting account)

```bash
npm ci && npm run build && npm start      # serves on http://localhost:3000
npx cloudflared tunnel --url http://localhost:3000   # prints a temporary https://…trycloudflare.com URL
```

This is free and needs no account. The link works only while the laptop and command stay running, and the URL changes each time.

## Same Wi-Fi only (already works)

`npm run dev -- -H 0.0.0.0`, then open `http://<laptop-ip>:3000` on a phone on the same network.

## Pre-deployment checklist

- [ ] `npm test`, `npm run typecheck` and `npm run build` all pass
- [ ] All data is fictional: no real guest names, numbers or the owner's real guest-house system
- [ ] No keys in git: `.env*` is ignored and keys are entered in the host dashboard only
- [ ] `AI_MODE=simulation` for the first deploy; switch to Meta only after the connection test passes locally
- [ ] `GOOGLE_MAPS_BILLING_APPROVED` left `false`
- [ ] Owner has approved the hosting choice and any Meta spend
