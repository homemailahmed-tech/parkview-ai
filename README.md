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
npm test                     # 77 automated tests
npm run typecheck
npm run build
```

Requires Node.js 20+. Use the **Staff / Owner** switch in the top bar to see owner-only actions.
**Reset demo data** is at the bottom of the desktop sidebar (state is kept in the browser's localStorage).

**Mobile preview:** run `npm run dev -- -H 0.0.0.0` and open `http://<your-computer-ip>:3000` on a phone on the same Wi-Fi.
The site is not deployed anywhere yet.

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
    ai/                     provider interface, Meta Llama provider, simulation provider, service (fallback + guards)
    maps/                   Smart Maps types, sample places, geo helpers, concierge, places/routing providers
  app/api/                  server routes (keys stay server-side): ai/status, ai/interpret, ai/explain, ai/draft, concierge, maps/route
  components/               dashboard UI (Tailwind) + reusable SmartMap
tests/                      vitest suites
```

### Guard-rails: what the AI may and may not do

The language model (Meta Llama, or the simulator) is used **only** for language:
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

`src/lib/ai/metaLlamaProvider.ts` calls an **OpenAI-compatible Chat Completions** endpoint — the shape offered by Meta's Llama API
and by approved open-weight hosts (Fireworks, Together, Baseten/Modal + vLLM). Only model ids containing `llama` are accepted.

**Status: implemented and unit-tested with mocked HTTP; NOT yet tested against a live endpoint** (no credentials available).
To enable: set `AI_MODE=meta` and the `META_LLAMA_*` variables in `.env.local`, restart, and check the badge in the top bar
changes from *Simulation* to *Meta Llama*. If a live call fails, the app falls back to simulation and says so next to the output.

Simulation output is always labelled **"SIMULATION · not Meta AI"**. Claude or other non-Meta models are not used as a substitute.

## AI Smart Maps & Travel Concierge

* `SmartMap` (`src/components/maps/SmartMap.tsx`) is property-agnostic: pass any `MapProperty` and `Place[]` to reuse it.
* Map tiles: OpenStreetMap (free, attribution shown). For production traffic, switch to a commercial tile provider per the OSM tile policy.
* Directions / route back: Google Maps **URL** deep links — free, no API key, no billing.
* Categories: Halaal food, hospitals, universities, shopping, beaches, family attractions, sports venues, airport, transport, local events.
* Concierge: the AI (Meta or simulation) maps the question to categories; places are ranked deterministically (family-friendly first for children, then nearest) with caveats.
* **Google Places (New) + Routes API** providers are written but **disabled**. They activate only with `MAPS_*_PROVIDER=google`, a server-side key, **and** `GOOGLE_MAPS_BILLING_APPROVED=true`. These APIs are billable — owner approval required.

Sample destinations: real Durban landmarks are marked *approximate location* (coordinates are approximate and must be verified by a live provider);
Halaal eateries and events are *fictional placeholders*. The guest house location is fictional.

## Testing

`npm test` runs 77 tests across: room capacity, couples & separate beds, accessibility, group allocation (drivers/leaders, families, Option A/B),
conflicting bookings, quotation totals & tamper detection, owner-approval and payment guards, invalid/missing enquiry information,
Meta provider (mocked HTTP, fallback, eligibility), and Smart Maps (labelling, billing gate, concierge).

See [`docs/DEMO_PLAN.md`](docs/DEMO_PLAN.md) for the hackathon demo script and roadmap.
