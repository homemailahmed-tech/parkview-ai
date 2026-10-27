# Hospitality AI

**AI-assisted enquiry, room-allocation and quotation assistant for independent guest houses — with an AI Smart Maps travel concierge.**
Built for the Meta Global AI Developer Hackathon 2026.

> **Demo data only.** *Parkside Demo Guest House*, its guests, phone numbers, bookings, rates and address are fictional.
> No real guest data, payments or WhatsApp messages are used.

## What it does

| Area | What works today |
| --- | --- |
| **Dashboard** | Mobile-first overview: occupancy tonight, new enquiries, open quote value, items needing attention, pipeline. |
| **Accommodation inventory** | 9 rooms / 29 guests with bed layouts, floors, accessibility, fictional room-based rates, and a 14-day availability grid. |
| **Enquiry inbox** | WhatsApp-style thread and composer (simulated — no live WhatsApp). AI reads the message and suggests dates and guest parties, which staff can edit. |
| **Room allocation** | Deterministic engine produces **Option A (most efficient)** and **Option B (more privacy & comfort)**, shows the bed plan per room, and explains the difference. |
| **Quotation builder** | Room-based pricing, group discount, deposit, notes; copy-ready WhatsApp quotation. AI may only write the greeting. |
| **Owner approval workflow** | Enquiry → Draft Quote → Owner Approval → Quote Sent → Guest Acceptance → Awaiting Payment → Confirmed, with audit trail. |
| **Smart Maps & concierge** | Interactive Durban map (Leaflet + OpenStreetMap), 10 categories, clickable markers, directions, "take me back to my accommodation", arrival/parking info, natural-language questions. |

## Quick start

```bash
npm install
cp .env.example .env.local   # optional — defaults to simulation mode
npm run dev                  # http://localhost:3000
npm test                     # 142 automated tests
npm run typecheck
npm run build
```

Requires Node.js 22. In local development (`npm run dev`) the **Staff / Owner** switch works freely. On a deployed site, owner mode
needs the owner code (`OWNER_ACCESS_CODE`).
**Reset demo data** is at the bottom of the desktop sidebar (state is kept in the browser's localStorage).

**Phone demo:** see [`docs/DEPLOYMENT_PLAN.md`](docs/DEPLOYMENT_PLAN.md). It covers free Vercel Hobby hosting set up entirely from an
Android phone, with a demo access code and owner login. The site is not deployed yet.

## The demo property

| Room | Sleeps | Beds | Floor / features | Rate (fictional, ZAR/night) |
| --- | --- | --- | --- | --- |
| Room 1 · Accessible Triple | 3 | queen + single | ground, wheelchair accessible | 1 guest R850 · 2 R1 150 · 3 R1 500 |
| Room 2 · Park View Triple | 3 | 3 singles | first | R800 · R1 100 · R1 450 |
| Room 3 · Corner Triple | 3 | queen + single | first | R800 · R1 100 · R1 450 |
| Room 4 · Family Room | 4 | 2 queens | first | R1 100 · R1 450 · R1 750 · R2 050 |
| Room 5 · Courtyard Triple | 3 | 3 singles | ground | R800 · R1 100 · R1 450 |
| Room 6 · Private Entrance Triple | 3 | queen + single | ground, private entrance | R900 · R1 200 · R1 550 |
| Room 7 · Ground Floor Double | 2 | double | ground | R750 · R1 000 |
| Room 8 · Ground Floor Queen | 2 | queen | ground | R800 · R1 050 |
| Self-Catering Apartment | 6 | 2 doubles + bunk | ground, private entrance, kitchen | up to 4 R2 400, +R300 per extra guest |

**Total capacity: 29 guests.** Pricing is per room by occupancy — never a flat per-person rate.

## Architecture

```
src/
  lib/                      ← framework-free, fully unit-tested domain logic
    domain/                 types, dates, money
    data/                   demo property, sample bookings, seeded enquiries
    allocation/             beds.ts (who sleeps where) + engine.ts (search, relaxations, verification)
    quote/                  room-based pricing, totals verification, WhatsApp text
    workflow/               state machine — owner approval + simulated payment guards
    enquiry/                extraction schema + validation, simulated parser
    ai/                     provider interface, config + eligibility, Meta provider (Model API & open-weight), chat client, simulation, service (fallback, guards, budget)
    maps/                   Smart Maps types, sample places, geo helpers, concierge, places/routing providers
  app/api/                  server routes (keys stay server-side): ai/status, ai/interpret, ai/explain, ai/draft, concierge, maps/route
  components/               dashboard UI (Tailwind) + reusable SmartMap
tests/                      vitest suites
```

### Guard-rails: what the AI may and may not do

The language model (Meta Muse Spark / Meta open-weight, or the simulator) is used **only** for language:
interpreting enquiries, explaining options, writing a greeting, and interpreting concierge questions.

Deterministic code owns everything that matters:

* **Extraction is validated** (`validateExtraction`) — bad dates, negative or fractional counts are dropped and listed as issues; missing info is listed.
* **Allocation** never exceeds capacity, never double-books, respects couples/separate beds, wheelchair/ground-floor needs, private rooms for drivers/leaders, and keeps families together. Every option passes an independent `verifyOption` check before it is shown.
* **Prices** are recomputed from the room table; `verifyQuoteTotals` rejects any inconsistent quote. AI wording containing figures is replaced.
* **Workflow:** only the owner can approve; editing a quote voids approval; a booking cannot be confirmed without owner approval of the *current* quote version **and** a recorded (simulated) deposit; availability is re-checked at approval and confirmation.
* **Maps:** distances shown are labelled straight-line; travel times only appear from a genuine routing provider; opening hours only from live data; Halaal status is always "not verified" unless an authoritative source confirms it.

### Allocation engine

Guests are grouped into *parties* (couple, family, individual, team member, driver, group leader) with requirements.
A branch-and-bound search (deterministic, node-limited, with symmetry breaking) finds the best arrangement under two objectives:

* **Efficient:** fewest rooms, then lowest room-based price.
* **Privacy & comfort:** fewest parties sharing a room, then fewer adults on bunks / children sharing beds, then price.

If the two coincide, Option B offers the best arrangement in different rooms. If nothing fits, the engine relaxes in steps
(split a family too big for any room → split parties → couples in separate beds), flagging every compromise, and suggests
nearby check-in dates. If still impossible, it explains why.

## Meta AI integration

The language layer is a **provider switchboard** (`src/lib/ai/config.ts`). All providers share one client and the same validation:

| `AI_MODE` | Route | Defaults |
| --- | --- | --- |
| `simulation` *(default)* | Rule-based stand-in, always labelled **SIMULATION · not Meta AI** | — |
| `meta-model-api` | Meta's hosted **Meta Model API**, the hackathon's primary route | `https://api.meta.ai/v1`, `muse-spark-1.3` |
| `groq` | **GroqCloud**, using a Meta model your account can access | `https://api.groq.com/openai/v1`, no default model |
| `openrouter` | **OpenRouter**, free-only (`:free` ids) unless paid use is approved | `https://openrouter.ai/api/v1`, no default model |
| `open-weight` | Any other OpenAI-compatible host (Fireworks, Baseten, Modal, Together) | set base URL and model |

See **[`docs/AI_PROVIDERS.md`](docs/AI_PROVIDERS.md)** for the verified endpoints, model ids, prices and eligibility notes.
In October 2026 no Meta model was verified as both free and generally available on Groq or OpenRouter.
The owner-only **List available Meta models** button checks the account's live catalogue for free.

Request format follows Meta's Chat Completions docs (`dev.meta.ai/docs/protocols/chat-completions`): `POST {base}/chat/completions`,
`Authorization: Bearer <key>`. Meta's docs do not yet confirm JSON mode (`response_format`) on the hosted API, so `AI_JSON_MODE=auto`
asks for it and retries once without it if rejected. Prompting and deterministic validation enforce JSON either way.

**Model eligibility:** each model is classed as **Meta Model API**, **Meta open-weight** or **non-Meta development**.
Muse Spark, Muse Spark Open and Llama ids are accepted as Meta models, as are exact ids in `AI_EXTRA_ALLOWED_MODELS`.
Non-Meta models (GPT, Gemini, Qwen and others) are refused unless `AI_ALLOW_NON_META_DEV_MODEL=true`.
In that case their output is labelled **DEV MODEL · not Meta AI · not hackathon-eligible** and never shown as Meta AI.

**Reliability and safety:**
- request timeout
- bounded retries for HTTP 429, 5xx, timeouts and network errors
- no retry on rejected credentials
- keys redacted from errors
- a daily cap on live calls (`AI_DAILY_CALL_LIMIT`)
- owner-only connection test and model-catalogue tools, which need an owner login

Any failure falls back to simulation with the reason shown next to the output.

**Telling real Meta AI from simulation:** an output is tagged **✓ Live Meta AI · \<route\> · \<model\>** only when that exact response came back
from a Meta model. The header badge shows what is *configured*. The Overview shows the AI provider panel with configuration issues and warnings.

**Status: implemented and tested with mocked HTTP (success, invalid key, timeout, 429/503, network failure, malformed output, JSON-mode fallback,
budget cap). Not yet run against a live endpoint — no credentials available.** See [`docs/ACTIVATE_META_AI.md`](docs/ACTIVATE_META_AI.md).

## AI Smart Maps & Travel Concierge

* `SmartMap` (`src/components/maps/SmartMap.tsx`) is property-agnostic: pass any `MapProperty` and `Place[]` to reuse it.
* Map tiles: OpenStreetMap (free, attribution shown). `SmartMap` accepts `tileUrl`/`tileAttribution` to switch to a commercial tile provider for production traffic (OSM tile policy).
* Failure handling: tile outages and offline use are detected and announced, a **List** view works without the map (and is used automatically if the map cannot start),
  live Places failures fall back to labelled samples, and routing errors are shown rather than replaced by estimated travel times.
* Directions / route back: Google Maps **URL** deep links — free, no API key, no billing.
* Categories: Halaal food, hospitals, universities, shopping, beaches, family attractions, sports venues, airport, transport, local events.
* Concierge: the AI (Meta or simulation) maps the question to categories; places are ranked deterministically (family-friendly first for children, then nearest) with caveats.
* **Google Places (New) + Routes API** providers are written but **disabled**. They activate only with `MAPS_*_PROVIDER=google`, a server-side key, **and** `GOOGLE_MAPS_BILLING_APPROVED=true`. These APIs are billable — owner approval required.

Sample destinations: real Durban landmarks are marked *approximate location* (coordinates are approximate and must be verified by a live provider);
Halaal eateries and events are *fictional placeholders*. The guest house location is fictional.

## Testing

`npm test` runs 142 tests across: room capacity, couples & separate beds, accessibility, group allocation (drivers/leaders, families, Option A/B),
conflicting bookings, quotation totals & tamper detection, owner-approval and payment guards, invalid/missing enquiry information,
Meta AI providers and switchboard (Meta Model API, Groq, OpenRouter, open-weight: config, model classes, mocked success/failure modes,
free-only guard, catalogue check, budget, connection test), API routes (no key leakage), secret hygiene,
Smart Maps (labelling, billing gate, concierge, tile/places/routing failures), and deployment security (signed sessions,
demo gate, owner login, owner-only tools, rate limits, security headers, data hygiene).

See [`docs/DEMO_PLAN.md`](docs/DEMO_PLAN.md) for the demo script and roadmap, and [`docs/DEPLOYMENT_PLAN.md`](docs/DEPLOYMENT_PLAN.md) for the phone-only deployment steps (not yet deployed).

## Security for the public demo

| Control | Variable |
| --- | --- |
| Site-wide demo access code, shared with judges. Signed HttpOnly cookie | `DEMO_ACCESS_CODE` |
| Owner login for approvals, payments and AI tools. Locked on deployed sites without it | `OWNER_ACCESS_CODE`, `SESSION_SECRET` |
| Optional: let visitors try owner role in their own browser sandbox | `DEMO_PUBLIC_OWNER_MODE` |

Also built in:
- rate limits (stricter on code entry)
- a strict Content-Security-Policy and other security headers
- `noindex`
- server-only API keys
- tests that fail if browser code reads environment variables or if real guest-house references appear

Demo state lives in each visitor's own browser. There is no shared database, so nothing one visitor does affects another.
