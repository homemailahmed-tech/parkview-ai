# What was built during the Meta Global AI Developer Hackathon 2026

This repository is a **new codebase**, started during the hackathon building period (27 Oct – 4 Nov 2026). It is **not** an existing product.

The developer runs a separate guest-house management system. **None of that system's code or data is in this repository**, and it is not part of this submission. All guests, bookings, rates and the property itself are fictional.

## Timeline

Run `git log --reverse --format='%ad  %s' --date=iso` to see every commit.

| Date (UTC) | Work |
|---|---|
| 27 Oct 2026 | Repository created |
| 27 Oct 2026 | **Domain core:** deterministic room-allocation engine (bed plans, couples, separate beds, accessibility, private rooms for drivers and leaders, conflicts, alternative dates); room-based pricing and quote verification; owner-approval workflow with simulated payment; enquiry-extraction schema and validation; Smart Maps library (76 tests) |
| 27 Oct 2026 | **Dashboard UI:** inbox, inventory, allocation view, quote panel, pipeline, Smart Maps view; API routes; fictional demo data |
| 27 Oct 2026 | **Meta Model API integration:** Muse Spark 1.3 provider, Chat Completions client, model eligibility, labelled simulation fallback, live-call budget; Meta open-weight host support |
| 27 Oct 2026 | **Security for a judge demo:** demo access code, owner login, signed sessions, rate limits, security headers (142 tests) |
| 1 Nov 2026 | **Live Meta verification:** two authenticated Muse Spark 1.3 requests ([LIVE_META_VERIFICATION.md](LIVE_META_VERIFICATION.md)) |
| 1 Nov 2026 | **Head-count guard** for a real under-count found in live testing; **booking-safeguard tests**; price filter on AI explanations; `reasoning_effort` and token-usage tracking |
| 1 Nov 2026 | Product name "ParkView AI"; fictional room names; guest-count guard sums all numbered groups in a message (found in demo rehearsal); quote table fits phone screens (155 tests) |

## What is live Meta AI and what is not

| Feature | Status |
|---|---|
| Interpreting guest enquiries with Muse Spark 1.3 (Meta Model API) | **Verified live** (1 Nov 2026) |
| AI explanation of room options, AI quote greeting, concierge question interpretation | Integrated; tested with **mocked** responses only |
| WhatsApp | **Simulated**: the app produces copy-ready text; no WhatsApp API |
| Payments | **Simulated** deposit records only |

In the app, every AI output is labelled **✓ Live Meta AI · …** or **SIMULATION**.

## How it was built

The developer designed, directed and tested the project. The code was written with an AI coding assistant (Claude Code) under that direction. Commits show this with a `Co-Authored-By` line. Every deterministic rule is covered by automated tests (`npm test`).
