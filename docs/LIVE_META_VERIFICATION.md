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

- ~~Option explanations, the WhatsApp greeting~~: verified live in Stage 4 (below). The concierge is still mocked only.
- `AI_JSON_MODE=auto` / `response_format` on the hosted API (the test used `prompt` mode).

**Reasoning headroom.** Request 2 used 644 of 800 output tokens on reasoning. `.env.example` therefore recommends `AI_MAX_OUTPUT_TOKENS=1200`. If the limit is reached, the app falls back to labelled simulation; it never shows an empty or partial AI answer.

---

# Stage 4 live integration tests (1 Nov 2026)

**Setup:**
- 8 authenticated requests to `https://api.meta.ai/v1`, approved by the owner.
- Hard caps enforced in the app before every request: 8 calls (6 Muse Spark + 2 Muse Voice Transcribe), US$0.04.
- No retries. `max_tokens` 1200. `reasoning_effort` minimal.
- Pass criteria were written **before** the run (`docs/verification/live-suite.check.ts`).
- Raw evidence: [`docs/evidence/stage4-live-evidence.json`](evidence/stage4-live-evidence.json) and [`stage4-ledger.json`](evidence/stage4-ledger.json).
- Reference date: Sunday 1 Nov 2026.

| # | Test | Model | Response / session id | Latency | Tokens in/out (reasoning) or audio | Cost (US$) | Result |
|---|---|---|---|---|---|---|---|
| 1 | V1: voice, clean synthetic speech | muse-voice-transcribe-1.0 | voyager/transcribe/2A428139… | 2.3 s | 9.36 s audio | 0.00047 | **FAIL** (content): "netball" → "ball"; "two nights" → "nights" |
| 2 | V2: voice, same speech + pink noise | muse-voice-transcribe-1.0 | voyager/transcribe/4CC477C2… | 2.4 s | 9.36 s audio | 0.00047 | **FAIL** (content): "twelve netball" → "well little"; "two nights" → "tonights" |
| 3 | I-H-1: netball, isiZulu greeting, "Friday after next" | muse-spark-1.3 | chatcmpl-01a196ca-431f… | 3.9 s | 395 / 547 (438) | 0.00282 | **PASS** |
| 4 | I-H-2: choir correction, ambiguous 17th guest | muse-spark-1.3 | chatcmpl-01a196ca-5433… | 4.4 s | 415 / 616 (485) | 0.00314 | **PASS** |
| 5 | I-H-3: Afrikaans family | muse-spark-1.3 | chatcmpl-01a196ca-5fed… | 3.0 s | 401 / 506 (403) | 0.00265 | **PASS** |
| 6 | C1: clarifying reply for H-1 | muse-spark-1.3 | chatcmpl-01a196ca-68c8… | 2.2 s | 239 / 406 (332) | 0.00202 | **PASS** |
| 7 | E1: explain choir options A/B | muse-spark-1.3 | chatcmpl-01a196ca-744c… | 2.8 s | 636 / 579 (469) | 0.00326 | **PASS** |
| 8 | G1: quote greeting | muse-spark-1.3 | chatcmpl-01a196ca-7bcf… | 1.9 s | 149 / 280 (231) | 0.00138 | **PASS** |

**Total: 8 calls, US$0.0162** (Muse Spark costs from reported usage at $1.25/$4.25 per M tokens; voice from audio duration at $0.18/hour).

## Voice: real accuracy on synthetic speech

- **Test audio:** ffmpeg's built-in flite voice, which is robotic. It is not a human or South African speaker.
- **Reference** (27 words): "Hello. We have twelve netball girls, two coaches and the bus driver, arriving on the thirteenth of November for two nights. One coach cannot use stairs."
- **Clean:** about 93 % word accuracy. Kept 12, coaches, bus driver, 13 November and stairs; lost "net" and "two".
- **Noisy:** about 81 %. Lost "twelve" and "two"; inserted "We".
- **Booking-critical misses:** the stay length (both clips) and the girls' count (noisy).
- **How the app handles this:**
  - the transcript is editable and is never processed automatically;
  - downstream guards ask for the missing nights and the total head-count (replayed in `tests/liveReplay.test.ts`).
- **Not yet tested:** real human voice notes, South African accents, and isiZulu or Afrikaans speech.

## Muse Spark vs the rule-based simulator (same messages)

| Enquiry | Rule-based simulator | Muse Spark 1.3 (live) |
|---|---|---|
| H-1 netball | 15 people, **no dates** ("Friday after next" not understood) | 15 people (asks whether the girls are minors); **13 Nov** (correct for "the Friday after next" from Sunday 1 Nov); driver; 1 ground floor; asks to confirm two nights. The app adds "dates to confirm" |
| H-2 choir correction | Check-in **4 Mar 2027 (wrong)**; 16; misses the gogo question | **21 Nov, 3 nights** (correction applied); 16 + question "Is gogo included in the 16 or extra?"; 4 couples; separate beds; 1 ground floor |
| H-3 Afrikaans | **Nothing understood** | 3 adults + 3 children, **14 → 21 Dec (7 nights)**, self-catering, grandmother on the ground floor: **all correct** |

## Quality notes

- **C1 (clarifying reply):** polite, no prices or promises. **Redundant:** it asks about the stay length twice (one deterministic question, one from the model). It also asks whether the coaches need their own rooms, which the guest did not raise.
- **E1 (explanation):** every room assignment it states matches the engine's options. It does not mention that the wheelchair user's couple has the accessible room.
- **G1 (greeting):** no figures. Wording slightly off ("the option you asked about").

## Safety guards on the live outputs

Replayed offline in `tests/liveReplay.test.ts`:
- H-1 cannot be quoted until the dates are confirmed and a check-out is given.
- H-2 keeps the 17th-guest question, and allocates 16 within capacity with the ground-floor need honoured.
- H-3 prices come only from the room table, and an AI or system actor cannot approve.
- C1, E1 and G1 contain no prices or availability claims.
- No live answer bypassed a guard.

## Follow-up after the owner's review (no new calls)

- **H-1 ages:** the reply listed 12 children while also asking whether they are children. The app now treats unstated ages as open, and blocks room allocation until they are confirmed.
- **H-2 gogo:** the 16-person allocation is **provisional**. Owner approval, sending and confirmation are locked until the question is resolved.
- **H-3:** the allocated room is the ground-floor self-catering apartment. The adult on a bunk is on the **bottom** bunk and a child is on top, so no climbing is needed. A top-bunk case would be flagged for owner review.
- **Quality:**
  - guest questions are de-duplicated and limited to booking-relevant topics;
  - explanations always include accessibility (appended by the app when the AI omits it, as it did here);
  - the greeting prompt was improved.
- **Not yet verified live:** the improved prompts. They are tested offline with these captured replies.

## Stage 5 live tests (1 Nov 2026)

- **Approval:** at most 8 calls and US$0.045, voice included; no retries. Caps enforced in the app ledger (8 calls, US$0.045, 7 Muse Spark, 1 voice).
- **Purpose:** re-test the Stage 4 weak points after the review fixes. Stage 4 evidence was not repeated without need.
- **Evidence:** `docs/evidence/stage5-ledger.json` (response ids, tokens, cost and the model output of every call) and `docs/evidence/stage5-ui-checks.json`.

| # | Test | Response id | Tokens in / out (reasoning) | US$ | Result |
|---|---|---|---|---|---|
| 1 | H-3 Afrikaans family | chatcmpl-01a196fc-7003… | 475 / 594 (491) | 0.00312 | **PASS**: dates, 3 adults + 3 children, self-catering and the stairs need all correct; the grandmother was put in her own party |
| 2 | H-2 choir correction | chatcmpl-01a196fd-0d9a… | 489 / 641 (524) | 0.00334 | **PASS with gap**: gogo and ages questions asked; adults left unstated, so the parties held 8 (provisional, count question open) |
| 3 | H-1 netball, revised prompt | chatcmpl-01a196fd-960a… | 469 / 653 (542) | 0.00336 | **PASS**: did not guess the girls' ages; 3 questions |
| 4 | Clarifying reply | chatcmpl-01a196fd-ba2a… | 243 / 282 (212) | 0.00150 | **PASS**: "Sawubona Thandeka…", one question per topic, no duplicates |
| 5 | Choir (Lindiwe) demo enquiry | chatcmpl-01a196fd-e3cb… | 463 / 482 (377) | 0.00263 | **PASS**: correct, and asked "Does the total of 14 include the bus driver?" |
| 6 | Option explanation | chatcmpl-01a196fe-0a76… | 716 / 700 (577) | 0.00387 | **PASS**: states the wheelchair-accessible ground-floor room |
| 7 | Quote greeting | chatcmpl-01a196fe-2e92… | 174 / 221 (182) | 0.00116 | **PASS**: no figures, improved wording |
| 8 | Voice (human recording) | — | — | 0 | **NOT RUN**: no human recording was available; the slot was not spent |

**Total: 7 calls, US$0.01897.** All runs to date: 17 genuine calls (2 + 8 + 7), about US$0.041.

**Gaps found live and fixed in code (no booking-engine change):**
- With several guest parties, the app assigns an access need to one party. In H-3 that was the family, not the grandmother. Staff must now confirm who uses the wheelchair or cannot use stairs (`openQuestionsFrom`, tested in `tests/stage5Live.test.ts`).
- A head-count answer could have been recorded while the parties held 8 people. A count answer must now state a total that matches the guest parties, and "all adults" is refused while the parties contain children (`resolveOpenQuestions`, `tests/resolution.test.ts`).
- With the revised prompt the model stopped guessing ages, so allocation was no longer blocked. Unstated ages now always block allocation.
- **Found afterwards (quote integrity):** in the same choir UI run, once the count question was answered, an 8-guest quote became approvable. Submitting, approval, sending and confirmation now re-check the quote against the current guest parties and dates (`quoteStaleReasons`, `tests/quoteIntegrity.test.ts`, `docs/evidence/quote-integrity-ui-check.json`). Not re-run live.

**Model accuracy, stated plainly:** Muse Spark miscounted guests in three live runs (2 of 14, 1 of 15, 8 of 16). The app's guards flagged the last two live; the fixes listed above came after the runs.

**Voice:** still only tested on synthetic English speech (Stage 4). No claim is made for human voices, South African accents, isiZulu or Afrikaans speech.

## Stage 6 — Evidence Trail live verification (2 Nov 2026)

- **Approval:** at most 5 Muse Spark calls and US$0.03; plan and pass criteria fixed before the run (`docs/verification/STAGE6_PLAN.md`, harness `docs/verification/stage6-evidence.check.ts`).
- **What was live:** 3 evidence calls only. The facts came from the genuine Stage 5 extractions, replayed offline, so the extractions were not re-run.
- **Evidence files:**
  - `docs/evidence/stage6-evidence-live.json` (raw model output, verdicts, response IDs);
  - `docs/evidence/stage6-ledger.json` (cost);
  - `docs/evidence/stage6-replay.json` (genuine Stage 5 and 6 responses for labelled replay filming).

| # | Scenario | Response id | Tokens in / out (reasoning) | US$ | Result |
|---|---|---|---|---|---|
| 1 | H-3 Afrikaans | chatcmpl-01a19bf0-5a52… | 395 / 610 (408) | 0.00309 | 4/4 stated facts verified; correct but added-up values (total 6, adults 3) and the derived check-out flagged as **not stated** |
| 2 | H-2 Choir | chatcmpl-01a19bf0-6acc… | 413 / 561 (353) | 0.00290 | 5/5 stated facts verified (incl. "make it 3 nights instead of 2" → 3); **parties' 8 guests = CONFLICT** ("now 16 of us"); 8 adults = not stated |
| 3 | H-1 Netball | chatcmpl-01a19bf0-7725… | 347 / 540 (396) | 0.00273 | 2/2 stated facts verified; **parties' 1 guest = CONFLICT** (12 girls, 2 coaches, driver); relative date = uncertain |

**Total: 3 calls, US$0.00872.** All runs to date: **20 genuine calls** (18 Muse Spark, 2 voice), about **US$0.0495**.

**Pass criteria, all met:**
- (a) every displayed quote is in the message;
- (b) the choir's 8 is flagged;
- (c) no doubtful head-count shown as confirmed;
- (d) coverage 11/11 (≥ 80 % required);
- (e) 0 invented quotes;
- (f) IDs and costs recorded.

**What this proves and what it does not:**
- **Code proves:** each quote exists in the message and contains the fact's number or date.
- **Not proven:** that the model understood the meaning; a matching quote can still be the wrong evidence.
- **Corrections, negation, several numbers and open head-count questions** are handled conservatively: uncertain, never "stated".
- **Single-person needs** ("she can't do stairs") are accepted as "one person" without a number.
