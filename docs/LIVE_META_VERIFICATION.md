# Live Meta Model API verification

**Date:** 1 November 2026
**Route:** Meta Model API, `POST https://api.meta.ai/v1/chat/completions`
**Model:** `muse-spark-1.3` (configured and served)
**Data:** fictional enquiries only. No real guests, phone numbers or bookings.

## Limits applied to the test

| Limit | Value |
|---|---|
| Requests | **2 in total**, enforced by a persisted counter that refuses a third request before it is sent |
| Retries | 0 (`AI_MAX_RETRIES=0`); JSON mode `prompt`, so there is no automatic second request |
| Output tokens | `max_tokens: 800` on every request, checked before sending |
| Reasoning | `reasoning_effort: minimal` |
| Cost ceiling | Worst case for both requests checked to be under US$0.01 before sending |
| Key handling | Read from the server environment; never printed; outputs scanned and redacted |

## Results

Prices used for the cost figures: US$1.25 per million input tokens and US$4.25 per million output tokens (reported Muse Spark pricing).

| | Request 1 | Request 2 |
|---|---|---|
| Enquiry (fictional) | Netball club: 12 players and 2 coaches, 11–13 Dec 2026, coaches need own rooms, separate beds, one wheelchair user | The app's seeded demo enquiry "Lindiwe": church choir of 14 adults, 4 couples, a bus driver who needs his own room, one wheelchair user |
| HTTP status | 200 | 200 |
| Served model | `muse-spark-1.3` | `muse-spark-1.3` |
| Response id | `chatcmpl-01a1954d-12cb-769e-9930-a48e7ceccea8` | `chatcmpl-01a1954f-76ae-70c0-a61a-1573b9713a9a` |
| Latency | 3.3 s | 3.6 s |
| Tokens (input / output / of which reasoning) | 258 / 444 / 348 | 252 / 721 / 644 |
| Finish reason | stop | stop |
| Labelled in the app as | Live Meta AI (`source: meta`) | Live Meta AI (`source: meta`) |
| Cost | US$0.0022 | US$0.0034 |

**Total: 2 requests, about US$0.0056.**

### Request 1 — what Muse Spark returned

```json
{"guestName": "Naledi", "checkIn": "2026-12-11", "checkOut": "2026-12-13", "nights": 2, "groupLeaders": 2,
 "wheelchairUsers": 1, "separateBeds": true,
 "notes": ["netball club tournament", "12 players happy to share rooms", "2 coaches need own rooms"]}
```

**Dates, coaches, separate beds and wheelchair need: correct.**

**The total number of adults was left out.** The 12 players appear only in a note. The validator then counted only the 2 coaches, so the deterministic engine would have produced options and a quote for **2 guests instead of 14**.

**Fixed in the same change, deterministically (no extra AI):**

1. If the total is not stated, the counted figure must be **confirmed by staff** (shown under "Missing").
2. The message is scanned for phrases such as "14 adults" or "12 players". If the interpretation has fewer guests, staff are asked to confirm the count.
3. The prompt now says `adults` means the **total** adults in the group.

`tests/safeguards.test.ts` replays this exact reply as a regression test.

### Request 2 — the seeded demo enquiry, after the fix

```json
{"guestName": "Lindiwe", "checkIn": "2026-11-21", "checkOut": "2026-11-23", "adults": 14, "couples": 4,
 "drivers": 1, "wheelchairUsers": 1, "notes": ["quote requested"]}
```

**All fields are correct:** no missing items, no validation issues.

The deterministic engine then produced, from the demo room table and bookings:
- Option A (most efficient): 5 rooms, R14 400.
- Option B (more privacy): 9 rooms, R20 700.
- Deposit 50 %.
- The wheelchair user's party was placed in the accessible room, and the driver in a private room.

The AI did not produce any availability, price or booking status.

## Not yet verified live

- Option explanations, the WhatsApp greeting and the concierge (same client and settings; mocked tests only).
- `AI_JSON_MODE=auto` / `response_format` on the hosted API (the test used `prompt` mode).

**Reasoning headroom.** Request 2 used 644 of 800 output tokens on reasoning. `.env.example` therefore recommends `AI_MAX_OUTPUT_TOKENS=1200`. If the limit is reached, the app falls back to labelled simulation; it never shows an empty or partial AI answer.
