import { describe, expect, it, vi } from "vitest";
import { HARD_ENQUIRIES } from "@/lib/data/hardEnquiries";
import { interpretEnquiry, type ProviderSelection } from "@/lib/ai/service";
import { MetaAIProvider } from "@/lib/ai/metaProvider";
import { SimulationProvider } from "@/lib/ai/simulationProvider";
import { CallBudget } from "@/lib/ai/budget";

/* REAL Muse Spark 1.3 outputs from the Stage 5 live run (1 Nov 2026; docs/evidence/stage5-ledger.json),
   replayed offline through the guards. */
const S5 = {
  h3: '{"guestName": "Annelie", "checkIn": "2026-12-14", "checkOut": "2026-12-21", "nights": 7, "adults": 3, "children": 3, "families": [{"adults": 2, "children": 3}], "groundFloorGuests": 1, "selfCatering": true, "notes": ["Grandmother cannot climb stairs"]}',
  h2: '{"guestName": "Mpho", "checkIn": "2026-11-21", "checkOut": "2026-11-24", "nights": 3, "couples": 4, "groundFloorGuests": 1, "separateBeds": true, "notes": ["16 people total", "gogo coming, cannot do stairs"], "clarifications": ["Is gogo included in the 16 or extra?", "How many of the 16 are adults vs children?"]}',
  h1: '{"guestName": "Thandeka", "checkIn": "2026-11-13", "drivers": 1, "groundFloorGuests": 1, "notes": ["1 coach uses crutches", "no stairs"], "clarifications": ["What date is check-out - is it two nights (check-out Sunday 15 November)?", "Are the 12 netball girls adults or children and how many of each?", "Do the two coaches need their own rooms?"]}',
};
const ctx = { today: "2026-11-01", propertyName: "Parkside Demo Guest House" };
const sel = (content: string): ProviderSelection => ({
  primary: new MetaAIProvider({ provider: "meta-model-api", label: "Meta Model API", hostLabel: "Meta", baseUrl: "https://api.meta.ai/v1", apiKey: "replay-not-real", model: "muse-spark-1.3", jsonMode: "prompt", timeoutMs: 5000, maxRetries: 0, maxOutputTokens: 1100 }, { fetchImpl: vi.fn(async () => new Response(JSON.stringify({ id: "r", model: "muse-spark-1.3", choices: [{ message: { content }, finish_reason: "stop" }] }), { status: 200 })) as unknown as typeof fetch, sleep: async () => {} }),
  simulation: new SimulationProvider(), config: { mode: "meta-model-api", issues: [], warnings: [] }, budget: new CallBudget(10),
});

describe("Stage 5 live outputs: guards found and closed real gaps", () => {
  it("H-3: the grandmother is a separate party, so WHO cannot use stairs becomes an open question (the app had given the need to the family)", async () => {
    const r = await interpretEnquiry(sel(S5.h3), HARD_ENQUIRIES[2].text, ctx);
    expect(r.data.units.map((u) => [u.label, u.access])).toEqual([["Annelie family", "ground-floor"], ["Guest 1", "none"]]);
    expect(r.data.openQuestions.find((q) => q.topic === "access")?.text).toMatch(/Which guest cannot use stairs\? The app assigned this need to Annelie family/);
  });

  it("H-1 (new prompt): Meta no longer guesses ages; allocation is still blocked because the guest did not state them", async () => {
    const r = await interpretEnquiry(sel(S5.h1), HARD_ENQUIRIES[0].text, ctx);
    expect(r.data.check.value.children).toBeUndefined();
    expect(r.data.openQuestions.some((q) => q.topic === "ages" && q.blocksAllocation)).toBe(true);
    expect(r.data.check.missing.join(" ")).toMatch(/mentions 12 people but the interpretation has 1/);
  });

  it("H-2: adults left unstated (only 8 counted from 4 couples) is an open count question; the booking stays provisional", async () => {
    const r = await interpretEnquiry(sel(S5.h2), HARD_ENQUIRIES[1].text, ctx);
    const count = r.data.openQuestions.find((q) => q.topic === "count");
    expect(count?.text).toMatch(/8 counted from the roles described/);
    expect(count?.text).toMatch(/Is gogo included in the 16 or extra\?/);
  });
});
