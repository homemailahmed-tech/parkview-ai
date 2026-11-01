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
| 1 Nov 2026 | **Hard enquiries** (isiZulu greeting + relative date, choir correction, Afrikaans family); interpreter returns **clarification questions**; deterministic **relative-date confirmation**; **AI clarification reply to the guest** with a guard against prices and booking promises |
| 1 Nov 2026 | **Owner review of Stage 4:** open questions make bookings provisional (approval, sending and confirmation locked); inferred ages block allocation; self-catering and "no stairs" checked on the actual rooms (top-bunk risk flagged); de-duplicated guest questions; accessibility always stated in explanations; labelled **replay** of captured Meta responses for demos (214 tests) |
| 1 Nov 2026 | **Honest labels** ("LOCAL TEST — MOCK RESPONSE" for any non-Meta endpoint); in-app spend ledger with hard caps; **Stage 4 live tests**: 8 calls, US$0.0162, 6/6 Muse Spark passed, voice worked with transcription errors ([details](LIVE_META_VERIFICATION.md)) (197 tests) |
| 1 Nov 2026 | **Voice dictation**: browser microphone → 16 kHz WAV → Muse Voice Transcribe file endpoint → editable transcript. The browser end-to-end test found and fixed a security header that blocked the microphone (176 tests) |

## What is live Meta AI and what is not

| Feature | Status |
|---|---|
| Interpreting guest enquiries with Muse Spark 1.3 (Meta Model API) | **Verified live** (1 Nov 2026) |
| Option explanations and quote greeting (Muse Spark) | **Verified live** (1 Nov 2026, Stage 4) |
| Concierge question interpretation | Integrated; tested with **mocked** responses only |
| Hard enquiries, clarification questions and clarification reply (Muse Spark) | **Verified live** (1 Nov 2026, Stage 4): 3/3 hard enquiries and the clarifying reply passed |
| Voice dictation (Muse Voice Transcribe) | **Live calls verified** (1 Nov 2026). Synthetic-speech accuracy about 93 % clean / 81 % noisy, with number errors caught by review and guards. Not tested with human speech |
| WhatsApp | **Simulated**: the app produces copy-ready text; no WhatsApp API |
| Payments | **Simulated** deposit records only |

In the app, every AI output is labelled:
- **✓ Live Meta AI**: only for a response from Meta's own endpoint (`https://api.meta.ai`);
- **SIMULATION**: rule-based fallback, including after a failed live call;
- **LOCAL TEST — MOCK RESPONSE**: any local or non-Meta test endpoint, even one imitating Meta's API.

## How it was built

The developer designed, directed and tested the project. The code was written with an AI coding assistant (Claude Code) under that direction. Commits show this with a `Co-Authored-By` line. Every deterministic rule is covered by automated tests (`npm test`).
