import { describe, expect, it, vi } from "vitest";
import { HARD_ENQUIRIES } from "@/lib/data/hardEnquiries";
import { relativeDatePhrase, validateExtraction } from "@/lib/enquiry/extraction";
import { interpretEnquiry, draftClarification, selectProvider, type ProviderSelection } from "@/lib/ai/service";
import { guestQuestions, violatesClarificationRules } from "@/lib/ai/clarify";
import { MetaAIProvider } from "@/lib/ai/metaProvider";
import { SimulationProvider } from "@/lib/ai/simulationProvider";
import { CallBudget } from "@/lib/ai/budget";

const ctx = { today: "2026-11-01", propertyName: "Parkside Demo Guest House" };

function mocked(content: string) {
  const bodies: Record<string, unknown>[] = [];
  const fetchImpl = vi.fn(async (_u: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    return new Response(JSON.stringify({ id: "r", model: "muse-spark-1.3", choices: [{ message: { content }, finish_reason: "stop" }] }), { status: 200 });
  }) as unknown as typeof fetch;
  const sel: ProviderSelection = {
    primary: new MetaAIProvider({ provider: "meta-model-api", label: "Meta Model API", hostLabel: "Meta", baseUrl: "https://api.meta.ai/v1", apiKey: "k-not-real", model: "muse-spark-1.3", jsonMode: "prompt", timeoutMs: 5000, maxRetries: 0, maxOutputTokens: 900, reasoningEffort: "minimal" }, { fetchImpl, sleep: async () => {} }),
    simulation: new SimulationProvider(),
    config: { mode: "meta-model-api", issues: [], warnings: [] },
    budget: new CallBudget(100),
  };
  return { sel, bodies };
}

describe("hard enquiries: the rule-based simulator's real limits (recorded, not sabotaged)", () => {
  const sim = selectProvider({});
  it("H-1 netball: the simulator cannot resolve 'the Friday after next', so staff are asked for dates", async () => {
    const r = await interpretEnquiry(sim, HARD_ENQUIRIES[0].text, ctx);
    expect(r.source).toBe("simulation");
    expect(r.data.check.value.checkIn).toBeUndefined();
    expect(r.data.check.missing.join(" | ")).toMatch(/Friday after next/);
  });
  it("H-3 Afrikaans: the simulator understands nothing, and says so (no invented guests)", async () => {
    const r = await interpretEnquiry(sim, HARD_ENQUIRIES[2].text, ctx);
    expect(r.data.check.missing).toContain("number of adults");
    expect(r.data.units).toEqual([]);
  });
});

describe("relative dates must be confirmed (deterministic)", () => {
  it("detects relative phrases in English and Afrikaans, not ordinary greetings", () => {
    expect(relativeDatePhrase("coming the Friday after next")).toMatch(/Friday after next/);
    expect(relativeDatePhrase("arriving next weekend")).toBe("next weekend");
    expect(relativeDatePhrase("ons kom volgende week")).toBe("volgende week");
    expect(relativeDatePhrase("Goeie môre! arriving 14 December")).toBeUndefined();
    expect(relativeDatePhrase("21 to 23 November")).toBeUndefined();
  });
  it("even when the model resolves the date, staff must confirm it with the guest", async () => {
    const r = await interpretEnquiry(mocked('{"checkIn":"2026-11-13","nights":2,"adults":3,"children":12,"drivers":1,"groupLeaders":2}').sel, HARD_ENQUIRIES[0].text, ctx);
    expect(r.data.check.value.checkIn).toBe("2026-11-13");
    expect(r.data.check.missing.join(" | ")).toMatch(/dates to confirm with the guest: they wrote "Friday after next" \(resolved from 2026-11-01\)/);
  });
});

describe("interpreter clarifications", () => {
  it("are validated: strings only, at most 5, and never about money", () => {
    const c = validateExtraction({ adults: 16, clarifications: ["Is gogo one of the 16 or the 17th guest?", 42, "", "Is R500 per night ok?", "a", "b", "c", "d", "e"] });
    expect(c.value.clarifications).toEqual(["Is gogo one of the 16 or the 17th guest?", "a", "b", "c", "d"]);
    expect(c.missing).toContain("to clarify: Is gogo one of the 16 or the 17th guest?");
  });
  it("the prompt tells the model about languages, corrections, relative dates and asking instead of guessing", async () => {
    const { sel, bodies } = mocked('{"adults":2}');
    await interpretEnquiry(sel, "2 adults", ctx);
    const system = String((bodies[0].messages as { content: string }[])[0].content);
    expect(system).toMatch(/Sunday\)/); // 2026-11-01 is a Sunday: the weekday anchors relative dates
    expect(system).toMatch(/mix languages/);
    expect(system).toMatch(/LATER statement wins/);
    expect(system).toMatch(/clarifications/);
  });
});

describe("clarification replies to the guest", () => {
  it("turns staff notes into guest questions deterministically", () => {
    expect(guestQuestions(["check-in date", "to clarify: Two nights or three?", "guest count to confirm: the message mentions 15 people but the interpretation has 3"])).toEqual([
      "Which date would you like to arrive?",
      "Two nights or three?",
      "How many people will be staying in total, including drivers, coaches or helpers?",
    ]);
    // Overlapping date notes collapse into one question.
    expect(guestQuestions(["check-in date", "check-out date or number of nights", 'dates: the guest wrote "Friday after next" — ask for exact dates'])).toEqual([
      "Could you please confirm your exact arrival date and how many nights you will stay?",
    ]);
  });
  it("flags replies that mention prices or promise availability", () => {
    expect(violatesClarificationRules("Rooms are available for you at R1 100 per night")).toBeDefined();
    expect(violatesClarificationRules("Great news, your booking is confirmed!")).toBeDefined();
    expect(violatesClarificationRules("Sawubona Thandeka! Could you confirm the exact Friday, and whether it is two nights?")).toBeUndefined();
  });
  it("a live reply that breaks the rules is replaced by the labelled template", async () => {
    const r = await draftClarification(mocked("Hi! We have rooms available, R900 per night. Which date?").sel, { guestName: "Thandeka", propertyName: "Parkside Demo Guest House", questions: ["Which date would you like to arrive?"], guestMessage: "Sawubona" });
    expect(r.source).toBe("simulation");
    expect(r.fallbackReason).toMatch(/replaced/);
    expect(r.data).toMatch(/1\. Which date would you like to arrive\?/);
  });
  it("a compliant live reply is kept and labelled as Meta, and the request carries only the questions and the guest's own message", async () => {
    const { sel, bodies } = mocked("Sawubona Thandeka! Could you please confirm which Friday you arrive, and whether you will stay two nights?");
    const r = await draftClarification(sel, { guestName: "Thandeka", propertyName: "Parkside Demo Guest House", questions: ["Which Friday?", "Two nights?"], guestMessage: HARD_ENQUIRIES[0].text });
    expect(r.source).toBe("meta");
    const user = JSON.parse(String((bodies[0].messages as { content: string }[])[1].content));
    expect(Object.keys(user).sort()).toEqual(["guestMessage", "guestName", "questions"]);
  });
});
