# ParkView AI: what is real, what is simulated, what is not built

Evidence for every advertised capability (status on 1 Nov 2026). Live evidence and response ids: [LIVE_META_VERIFICATION.md](LIVE_META_VERIFICATION.md) and [`docs/evidence/`](evidence/).

**Categories:**
- **META LIVE**: tested with genuine calls to Meta's API (`https://api.meta.ai`), with recorded response ids.
- **DETERMINISTIC**: ordinary code, covered by automated tests (`npm test`, 233 tests).
- **SIMULATION**: a stand-in, always labelled in the app.
- **NOT BUILT**: roadmap only.

| Capability | Category | Evidence |
|---|---|---|
| Read free-text enquiries (dates, counts, roles, needs) with Muse Spark 1.3 | **META LIVE** | 5 live interpretations, 1 Nov 2026: the choir (`chatcmpl-01a1954f…`), netball (`chatcmpl-01a1954d…`, `chatcmpl-01a196ca-431f…`), the choir correction (`…5433…`) and the Afrikaans family (`…5fed…`) |
| Mixed language (Afrikaans; isiZulu greeting), corrections, relative dates | **META LIVE** | Afrikaans enquiry fully correct; "the Friday after next" → 13 Nov; correction 14 → 16 applied |
| AI asks instead of guessing (clarification questions) | **META LIVE** | "Is gogo included in the 16 or extra?"; "Are the 12 netball girls children or adults?" |
| Clarifying WhatsApp reply to the guest | **META LIVE** (captured reply had a duplicate question; de-duplication now in code, mocked tests) | `…68c8…` |
| Explanation of room options | **META LIVE** (accessibility appended by code when omitted) | `…744c…` |
| Quote greeting | **META LIVE** (prompt improved afterwards; mocked test) | `…7bcf…` |
| Voice dictation with Muse Voice Transcribe 1.0 | **META LIVE**: calls work; accuracy imperfect | 2 calls; synthetic speech about 93 % / 81 % word accuracy; numbers misheard. Not tested with human voices |
| Replay of captured Meta responses for demos | **DETERMINISTIC** (labelled "▶ REPLAY · not a live call") | `tests/labels.test.ts` |
| Guest-count guard (message vs interpretation) | **DETERMINISTIC** | Caught a real live under-count (14 → 2); `tests/safeguards.test.ts` |
| Open questions (dates, count, ages, access, requirements) make a booking PROVISIONAL; owner approval, sending and confirmation are locked | **DETERMINISTIC** | `tests/stage4Followup.test.ts` |
| Inferred ages block room allocation until confirmed | **DETERMINISTIC** | Same |
| Self-catering and "no stairs" checked on the actual rooms; top-bunk risk flagged for owner review | **DETERMINISTIC** | Same |
| Room allocation, availability, capacity, bed plans, accessibility, private rooms | **DETERMINISTIC** | `tests/allocation.test.ts` |
| Room-based pricing and verified quote totals | **DETERMINISTIC** | `tests/pricing.test.ts` |
| Owner-only approval and payment; audit trail | **DETERMINISTIC** | `tests/workflow.test.ts` |
| AI never sets prices, availability or bookings; price and promise filters | **DETERMINISTIC** | `tests/safeguards.test.ts`, `tests/liveReplay.test.ts` (real live outputs replayed) |
| Honest labels (live / replay / mock / simulation / failure) and in-app spend caps | **DETERMINISTIC** | `tests/labels.test.ts` |
| Map concierge interpretation (Muse Spark) | **SIMULATION in tests**; never run live | `tests/maps.test.ts` (mocked) |
| WhatsApp sending | **SIMULATION**: copy-ready text only | — |
| Deposits and payments | **SIMULATION** | — |
| Direct website bookings, WhatsApp Business API, Booking.com / Airbnb channels, real payments, housekeeping, invoicing | **NOT BUILT** | Roadmap |
