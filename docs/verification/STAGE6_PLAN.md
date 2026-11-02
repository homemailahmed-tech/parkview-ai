# Stage 6 — Evidence Trail live verification (plan fixed BEFORE the run)

**Owner approval (2 Nov 2026):** at most **5** genuine Meta API calls and **US$0.03**, Muse Spark only. Hard cut-off for the feature: **3 Nov 2026 12:00 SAST**.

**Enforcement:** the app's spend ledger (`AI_SPEND_LEDGER`) blocks any request that would pass 5 calls or US$0.03. The harness refuses to start without those caps. No automatic retries (`AI_MAX_RETRIES=0`).

## Calls

| # | Scenario | Message | Facts checked |
|---|---|---|---|
| 1 | H-3 Afrikaans family | `HARD_ENQUIRIES[2]` | from the **genuine Stage 5 Muse Spark extraction** (replayed offline, no call) |
| 2 | H-2 Choir correction | `HARD_ENQUIRIES[1]` | same (the parties hold 8 of 16) |
| 3 | H-1 Netball | `HARD_ENQUIRIES[0]` | same (the parties hold 1 of 15) |
| 4–5 | Spare | — | Only to re-run a scenario whose call **failed technically** (no HTTP 200). Never to improve a result |

The extractions are **not** re-run live: Stage 5 already captured them, and re-running would spend calls for evidence we already have.

## Ground truth (decided before the run)

**Facts the message states literally (should be ✓ "stated"):**
- H-3: check-in 14 Dec ("vanaf 14 Desember"); children 3 ("drie kinders"); 1 guest needs no stairs ("my ouma wat nie trappe kan klim nie"); self-catering ("Selfsorg").
- H-2: check-in 21 Nov; nights 3 ("3 nights instead of 2"); couples 4; 1 guest no stairs ("gogo … can't do stairs"); separate beds.
- H-1: driver's own room ("The driver needs his own room"); 1 guest no stairs ("One coach uses crutches, so please no stairs").
- **Total: 11 facts.**

**Facts that must NOT be shown as stated:**
- H-2: the parties' 8 guests and 8 adults (the guest says 16).
- H-1: the parties' 1 guest (the guest names 12 girls, 2 coaches and a driver).

## Pass criteria

| ID | Criterion | Pass if |
|---|---|---|
| (a) | Every displayed quote occurs in the message | 100 % (code guarantees this; a failure means a bug) |
| (b) | Choir: the unsupported 8 guests / 8 adults are flagged | Both are "conflict" or "unsupported" |
| (c) | Ambiguous head-counts are not presented as confirmed | No head-count fact in H-1 or H-2 is "stated" |
| (d) | Coverage | At least 9 of the 11 ground-truth facts (≥ 80 %) are "stated" |
| (e) | No invented evidence displayed | Discarded quotes are counted and reported; none is shown |
| (f) | Evidence | Response IDs, tokens and cost recorded for every call |

Failures are reported as failures. The verdicts come only from the deterministic verifier. **The run can show that quotes exist and contain the numbers; it cannot prove the model understood the meaning.**
