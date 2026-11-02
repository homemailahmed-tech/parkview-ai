import { describe, expect, it, vi } from "vitest";
import { evidenceFacts, evidenceQuestions, locateQuote, verifyEvidence, type EvidenceFact } from "@/lib/ai/evidence";
import { HARD_ENQUIRIES } from "@/lib/data/hardEnquiries";
import { interpretEnquiry, type ProviderSelection } from "@/lib/ai/service";
import { MetaAIProvider } from "@/lib/ai/metaProvider";
import { SimulationProvider } from "@/lib/ai/simulationProvider";
import { CallBudget } from "@/lib/ai/budget";

/* Evidence Trail: the model cites words; CODE decides whether a citation counts. These tests use
   hand-written model outputs (no network). The live run is separate (Stage 6). */

const [NETBALL, CHOIR, AFRIKAANS] = HARD_ENQUIRIES.map((h) => h.text);
const ev = (...rows: [string, string | null, string?][]) => ({ evidence: rows.map(([key, quote, status]) => ({ key, quote, status: status ?? (quote ? "stated" : "not_stated") })) });
const fact = (key: EvidenceFact["key"], kind: EvidenceFact["kind"], value: EvidenceFact["value"], origin: EvidenceFact["origin"] = "ai"): EvidenceFact => ({ key, kind, value, origin, label: key });
const verdictOf = (r: ReturnType<typeof verifyEvidence>, key: string) => r.items.find((i) => i.fact.key === key)!;

/* Real Stage 5 Muse Spark outputs (docs/evidence/stage5-ledger.json), replayed offline. */
const S5 = {
  h3: '{"guestName": "Annelie", "checkIn": "2026-12-14", "checkOut": "2026-12-21", "nights": 7, "adults": 3, "children": 3, "families": [{"adults": 2, "children": 3}], "groundFloorGuests": 1, "selfCatering": true, "notes": ["Grandmother cannot climb stairs"]}',
  h2: '{"guestName": "Mpho", "checkIn": "2026-11-21", "checkOut": "2026-11-24", "nights": 3, "couples": 4, "groundFloorGuests": 1, "separateBeds": true, "notes": ["16 people total", "gogo coming, cannot do stairs"], "clarifications": ["Is gogo included in the 16 or extra?", "How many of the 16 are adults vs children?"]}',
};
const sel = (content: string): ProviderSelection => ({
  primary: new MetaAIProvider({ provider: "meta-model-api", label: "Meta Model API", hostLabel: "Meta", baseUrl: "https://api.meta.ai/v1", apiKey: "replay-not-real", model: "muse-spark-1.3", jsonMode: "prompt", timeoutMs: 5000, maxRetries: 0, maxOutputTokens: 1100 }, { fetchImpl: vi.fn(async () => new Response(JSON.stringify({ id: "r", model: "muse-spark-1.3", choices: [{ message: { content }, finish_reason: "stop" }] }), { status: 200 })) as unknown as typeof fetch, sleep: async () => {} }),
  simulation: new SimulationProvider(), config: { mode: "meta-model-api", issues: [], warnings: [] }, budget: new CallBudget(10),
});
const ctx = { today: "2026-11-01", propertyName: "Parkside Demo Guest House" };

describe("quotes must occur verbatim in the guest's message", () => {
  it("finds quotes despite case, curly quotes and spacing, and returns the span in the ORIGINAL message", () => {
    const span = locateQuote(CHOIR, "NOT 14 anymore,   now 16 of us")!;
    expect(CHOIR.slice(span[0], span[1])).toBe("not 14 anymore, now 16 of us");
    const af = locateQuote(AFRIKAANS, "drie kinders")!;
    expect(AFRIKAANS.slice(af[0], af[1])).toBe("drie kinders");
  });

  it("FABRICATED quotes are discarded and never displayed: invented, paraphrased, translated or stitched", () => {
    const facts = [fact("totalGuests", "count", 16), fact("selfCatering", "flag", true), fact("children", "count", 3)];
    const r = verifyEvidence(AFRIKAANS, facts, ev(["totalGuests", "we are 16 people"], ["selfCatering", "self-catering would be nice"], ["children", "drie kinders plus my ouma"]));
    expect(r.discarded).toBe(3);
    for (const i of r.items) {
      expect(i.verdict).toBe("unsupported");
      expect(i.quote).toBeUndefined();
      expect(i.reason).toMatch(/not in the message — discarded/);
    }
  });

  it("every displayed quote is an exact slice of the message", () => {
    const facts = evidenceFacts({ checkIn: "2026-11-21", checkOut: "2026-11-24", units: [] }, {});
    const r = verifyEvidence(CHOIR, facts, ev(["checkIn", "arriving 21 Nov"], ["checkOut", "make it 3 nights instead of 2"], ["nights", "3 nights instead of 2"]));
    for (const i of r.items.filter((x) => x.quote)) expect(CHOIR.slice(...i.span!)).toBe(i.quote);
  });
});

describe("numbers must actually be stated by the quoted words", () => {
  it("the right words with the WRONG number are not accepted", () => {
    const r = verifyEvidence(CHOIR, [fact("couples", "count", 5)], ev(["couples", "The 4 married couples"]));
    expect(verdictOf(r, "couples")).toMatchObject({ verdict: "unsupported", reason: expect.stringMatching(/say 4 — not 5/) });
  });

  it("number words count (English and Afrikaans)", () => {
    const r = verifyEvidence(AFRIKAANS, [fact("children", "count", 3)], ev(["children", "drie kinders"]));
    expect(verdictOf(r, "children").verdict).toBe("supported");
    const n = verifyEvidence(NETBALL, [fact("couples", "count", 2)], ev(["couples", "two coaches"]));
    expect(verdictOf(n, "couples").verdict).toBe("supported");
  });

  it("corrections: the later value is supported, the replaced value is a conflict", () => {
    const facts = [fact("nights", "count", 3)];
    expect(verdictOf(verifyEvidence(CHOIR, facts, ev(["nights", "make it 3 nights instead of 2", "corrected"])), "nights")).toMatchObject({ verdict: "supported", reason: expect.stringMatching(/Corrected by the guest to 3/) });
    expect(verdictOf(verifyEvidence(CHOIR, [fact("nights", "count", 2)], ev(["nights", "make it 3 nights instead of 2"])), "nights")).toMatchObject({ verdict: "conflict", reason: expect.stringMatching(/corrected this to 3/) });
    expect(verdictOf(verifyEvidence(CHOIR, [fact("totalGuests", "count", 14, "app")], ev(["totalGuests", "not 14 anymore, now 16 of us"])), "totalGuests").verdict).toBe("conflict");
  });

  it("negation: 'not N' never supports N", () => {
    const msg = "We are not 10, we are 12 people.";
    const r = verifyEvidence(msg, [fact("totalGuests", "count", 10)], ev(["totalGuests", "We are not 10"]));
    expect(verdictOf(r, "totalGuests")).toMatchObject({ verdict: "conflict", reason: expect.stringMatching(/not 10/) });
    const f = verifyEvidence("We don't need self-catering, thanks.", [fact("selfCatering", "flag", true)], ev(["selfCatering", "We don't need self-catering"]));
    expect(verdictOf(f, "selfCatering").verdict).toBe("conflict");
  });

  it("several numbers without a clear correction stay UNCERTAIN, never supported", () => {
    const r = verifyEvidence(NETBALL, [fact("couples", "count", 2)], ev(["couples", "12 netball girls, two coaches"]));
    expect(verdictOf(r, "couples").verdict).toBe("uncertain");
  });

  it("missing evidence: no quote, or a quote with no number, is unsupported", () => {
    const r = verifyEvidence(CHOIR, [fact("adults", "count", 8, "app"), fact("children", "count", 0)], ev(["adults", null], ["children", "everyone else separate beds pls"]));
    expect(verdictOf(r, "adults")).toMatchObject({ verdict: "unsupported", reason: expect.stringMatching(/No words in the message state this/) });
    expect(verdictOf(r, "children")).toMatchObject({ verdict: "unsupported", reason: expect.stringMatching(/no number/) });
  });

  it("the model's own 'stated' claim is never proof, and its 'contradicted' can only make things stricter", () => {
    const r = verifyEvidence(CHOIR, [fact("couples", "count", 4)], ev(["couples", "The 4 married couples", "contradicted"]));
    expect(verdictOf(r, "couples").verdict).toBe("uncertain");
  });

  it("dates: day and month must both be stated; relative and derived dates stay uncertain", () => {
    expect(verdictOf(verifyEvidence(CHOIR, [fact("checkIn", "date", "2026-11-21")], ev(["checkIn", "arriving 21 Nov"])), "checkIn").verdict).toBe("supported");
    expect(verdictOf(verifyEvidence(AFRIKAANS, [fact("checkIn", "date", "2026-12-14")], ev(["checkIn", "vanaf 14 Desember"])), "checkIn").verdict).toBe("supported");
    expect(verdictOf(verifyEvidence(NETBALL, [fact("checkIn", "date", "2026-11-13", "app")], ev(["checkIn", "the Friday after next"])), "checkIn").verdict).toBe("uncertain");
    expect(verdictOf(verifyEvidence(CHOIR, [fact("checkOut", "date", "2026-11-24", "app")], ev(["checkOut", "make it 3 nights instead of 2"])), "checkOut").verdict).toBe("uncertain");
    expect(verdictOf(verifyEvidence(CHOIR, [fact("checkIn", "date", "2026-11-22")], ev(["checkIn", "arriving 21 Nov"])), "checkIn").verdict).toBe("conflict");
  });

  it("an open head-count question means head-count facts are never shown as confirmed", () => {
    const msg = "Hi, we are 14 adults from the choir.";
    const facts = [fact("totalGuests", "count", 14, "app"), fact("adults", "count", 14)];
    const raw = ev(["totalGuests", "we are 14 adults"], ["adults", "14 adults"]);
    expect(verifyEvidence(msg, facts, raw).counts.supported).toBe(2);
    const r = verifyEvidence(msg, facts, raw, { countQuestionOpen: true });
    expect(r.items.map((i) => i.verdict)).toEqual(["uncertain", "uncertain"]);
  });

  it("hostile or malformed model output yields no evidence, not a crash", () => {
    const facts = [fact("couples", "count", 4)];
    for (const raw of [null, "x", { evidence: "x" }, { evidence: [null, 5, { key: 3 }] }, { evidence: [{ key: "couples", quote: "a".repeat(500) }] }]) {
      const r = verifyEvidence(CHOIR, facts, raw);
      expect(r.items[0].verdict).toBe("unsupported");
      expect(r.items[0].quote).toBeUndefined();
    }
  });
});

describe("Stage 5 cases (real Muse Spark extractions, hand-written citations)", () => {
  it("CHOIR: the app's 8 guests / 8 adults are flagged against the guest's 'now 16'; supported facts are verified", async () => {
    const r = await interpretEnquiry(sel(S5.h2), CHOIR, ctx);
    const facts = evidenceFacts({ checkIn: r.data.check.value.checkIn, checkOut: r.data.check.value.checkOut, units: r.data.units }, r.data.check.value);
    expect(facts.find((f) => f.key === "totalGuests")).toMatchObject({ value: 8, origin: "app" });
    expect(facts.find((f) => f.key === "adults")).toMatchObject({ value: 8 });
    const report = verifyEvidence(CHOIR, facts, ev(
      ["checkIn", "arriving 21 Nov"], ["checkOut", "make it 3 nights instead of 2", "corrected"], ["nights", "make it 3 nights instead of 2", "corrected"],
      ["totalGuests", "now 16 of us", "contradicted"], ["adults", null], ["couples", "The 4 married couples"],
      ["accessNeed", "gogo is coming too, she can't do stairs"], ["separateBeds", "everyone else separate beds pls"],
    ), { countQuestionOpen: true });
    expect(verdictOf(report, "totalGuests")).toMatchObject({ verdict: "conflict", reason: expect.stringMatching(/mention 16 people — the parties hold only 8/) });
    expect(verdictOf(report, "adults").verdict).toBe("unsupported");
    for (const k of ["checkIn", "nights", "couples", "accessNeed", "separateBeds"]) expect(verdictOf(report, k).verdict, k).toBe("supported");
    expect(verdictOf(report, "checkOut").verdict).toBe("uncertain");
    const qs = evidenceQuestions(report);
    expect(qs.map((q) => q.topic)).toEqual(["count", "count"]);
    expect(qs[0].text).toMatch(/Guests in the parties: 8/);
  });

  it("AFRIKAANS: stated facts are verified; added-up totals are uncertain, not 'confirmed' and not 'contradicted'", async () => {
    const r = await interpretEnquiry(sel(S5.h3), AFRIKAANS, ctx);
    const facts = evidenceFacts({ checkIn: r.data.check.value.checkIn, checkOut: r.data.check.value.checkOut, units: r.data.units, selfCatering: true }, r.data.check.value);
    const report = verifyEvidence(AFRIKAANS, facts, ev(
      ["checkIn", "vanaf 14 Desember"], ["checkOut", "vir 'n week bly vanaf 14 Desember"], ["nights", "vir 'n week"],
      ["totalGuests", "'n gesin van vyf – twee volwassenes en drie kinders – plus my ouma"], ["adults", "twee volwassenes en drie kinders – plus my ouma"],
      ["children", "drie kinders"], ["accessNeed", "my ouma wat nie trappe kan klim nie"], ["selfCatering", "Selfsorg sou lekker wees"],
    ));
    for (const k of ["checkIn", "children", "accessNeed", "selfCatering"]) expect(verdictOf(report, k).verdict, k).toBe("supported");
    for (const k of ["checkOut", "nights", "totalGuests", "adults"]) expect(verdictOf(report, k).verdict, k).toBe("uncertain");
    // The app's own defaults (parents share a bed; children in separate beds) are not checked as guest facts.
    expect(facts.map((f) => f.key)).not.toContain("couples");
    expect(facts.map((f) => f.key)).not.toContain("separateBeds");
    expect(evidenceQuestions(report)).toEqual([]);
  });
});

describe("service and route", () => {
  it("is NEVER simulated: without a Meta provider the result says so and contains no evidence", async () => {
    const { citeEvidence, selectProvider } = await import("@/lib/ai/service");
    const r = await citeEvidence(selectProvider({ AI_MODE: "simulation" } as never), CHOIR, [fact("couples", "count", 4)]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/never simulated/);
  });

  it("a Meta response is verified by code before it is returned (fabricated quote discarded, labelled meta)", async () => {
    const { citeEvidence } = await import("@/lib/ai/service");
    const out = JSON.stringify(ev(["couples", "The 4 married couples"], ["totalGuests", "we are eight adults"]));
    const r = await citeEvidence(sel(out), CHOIR, [fact("couples", "count", 4), fact("totalGuests", "count", 8, "app")]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.result.source).toBe("meta");
      expect(r.result.data.counts).toMatchObject({ supported: 1, unsupported: 1 });
      expect(r.result.data.discarded).toBe(1);
    }
  });

  it("the route rejects missing or invalid input and drops unknown facts", async () => {
    const { POST } = await import("@/app/api/ai/evidence/route");
    const call = (body: unknown) => POST(new Request("http://x/api/ai/evidence", { method: "POST", body: JSON.stringify(body) }));
    expect((await call({})).status).toBe(400);
    expect((await call({ message: "hi", facts: [] })).status).toBe(400);
    expect((await call({ message: "hi", facts: [{ key: "price", kind: "count", value: 100 }, { key: "nights", kind: "count", value: "x" }] })).status).toBe(400);
    expect((await call({ message: "x".repeat(4001), facts: [{ key: "nights", kind: "count", value: 2 }] })).status).toBe(400);
  });
});
