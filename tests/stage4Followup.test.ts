import { describe, expect, it, vi } from "vitest";
import { HARD_ENQUIRIES } from "@/lib/data/hardEnquiries";
import { interpretEnquiry, explainOptions, draftQuoteIntro, type ProviderSelection } from "@/lib/ai/service";
import { MetaAIProvider } from "@/lib/ai/metaProvider";
import { SimulationProvider } from "@/lib/ai/simulationProvider";
import { CallBudget } from "@/lib/ai/budget";
import { agesUnstated, guestQuestionsFrom, topicOf } from "@/lib/enquiry/openQuestions";
import { accessibilityFacts, requirementIssues } from "@/lib/allocation/requirements";
import { allocate } from "@/lib/allocation/engine";
import { DEMO_PROPERTY, DEMO_ROOMS } from "@/lib/data/property";
import { buildQuote } from "@/lib/quote/pricing";
import { canTransition, transition, type TransitionContext } from "@/lib/workflow/stateMachine";
import { unitsFromExtraction } from "@/lib/enquiry/extraction";
import type { Enquiry, StayRequest } from "@/lib/domain/types";

/*
 * Owner's Stage 4 review (1 Nov 2026). Fixtures are the REAL Muse Spark 1.3 outputs from the
 * Stage 4 live run (docs/evidence/stage4-live-evidence.json). Offline; no network.
 */
const LIVE_H1 = { guestName: "Thandeka", checkIn: "2026-11-13", adults: 3, children: 12, drivers: 1, groundFloorGuests: 1, notes: ["One coach uses crutches, needs no stairs"], clarifications: ["Are the 12 netball girls children or adults?", "Confirm staying two nights and check-out date?", "Do the two coaches need their own rooms?"] };
const LIVE_H2 = { guestName: "Mpho", checkIn: "2026-11-21", checkOut: "2026-11-24", nights: 3, adults: 16, couples: 4, groundFloorGuests: 1, separateBeds: true, notes: ["Group size changed from 14 to 16", "Gogo cannot do stairs, needs ground floor"], clarifications: ["Is gogo included in the 16 or extra?", "Are all 16 guests adults, any children?"] };
const LIVE_H3 = { guestName: "Annelie", checkIn: "2026-12-14", checkOut: "2026-12-21", nights: 7, adults: 3, children: 3, groundFloorGuests: 1, selfCatering: true, families: [{ adults: 3, children: 3 }], notes: ["Grandmother cannot climb stairs"] };
const LIVE_E1 = "Hi Lindiwe, here are two options for the group.\nOption A is the most efficient setup, with Couple 3 and Couple 4 sharing the Family Room, and Guest 2, Guest 3 and Guest 4 together in the Courtyard Triple.\nOption B offers more privacy and comfort, giving most couples and singles their own rooms, with only Guest 3 and Guest 4 sharing in the Private Entrance Triple.\nDriver 1 stays in the Ground Floor Double in both options.";

const ctx = { today: "2026-11-01", propertyName: DEMO_PROPERTY.name };
function replay(content: string) {
  const bodies: Record<string, any>[] = [];
  const fetchImpl = vi.fn(async (_u: string, init: RequestInit) => { bodies.push(JSON.parse(String(init.body))); return new Response(JSON.stringify({ id: "replay", model: "muse-spark-1.3", choices: [{ message: { content }, finish_reason: "stop" }] }), { status: 200 }); }) as unknown as typeof fetch;
  const sel: ProviderSelection = { primary: new MetaAIProvider({ provider: "meta-model-api", label: "Meta Model API", hostLabel: "Meta", baseUrl: "https://api.meta.ai/v1", apiKey: "replay-not-real", model: "muse-spark-1.3", jsonMode: "prompt", timeoutMs: 5000, maxRetries: 0, maxOutputTokens: 1200 }, { fetchImpl, sleep: async () => {} }), simulation: new SimulationProvider(), config: { mode: "meta-model-api", issues: [], warnings: [] }, budget: new CallBudget(10) };
  return { sel, bodies };
}
const C = (actor: TransitionContext["actor"]): TransitionContext => ({ actor, rooms: DEMO_ROOMS, bookings: [], depositPercent: DEMO_PROPERTY.depositPercent, now: "2026-11-02T00:00:00Z" });
function pendingApproval(request: StayRequest, openQuestions: Enquiry["openQuestions"]): Enquiry {
  const option = allocate(request, { rooms: DEMO_ROOMS, bookings: [] }).options[0];
  const quote = buildQuote({ id: "Q", enquiryId: "E", guestName: "G", request, option, property: DEMO_PROPERTY, now: "2026-11-01T00:00:00Z" });
  let e: Enquiry = { id: "E", guestName: "G", phone: "+27 00 000 0000", channel: "whatsapp", receivedAt: "2026-11-01T00:00:00Z", messages: [], status: "enquiry", request, events: [], openQuestions };
  e = transition(e, { type: "create_draft", quote }, C("staff"));
  return transition(e, { type: "submit_for_approval" }, C("staff"));
}

describe("A · unknown ages are not booking facts", () => {
  it("'12 netball girls' states no ages: deterministic check flags it, whatever the model says", () => {
    expect(agesUnstated(HARD_ENQUIRIES[0].text)).toBe(true);
    expect(agesUnstated(HARD_ENQUIRIES[2].text)).toBe(false); // Afrikaans: 'volwassenes' / 'kinders' are explicit
    expect(agesUnstated("church choir of 14 adults, 4 couples")).toBe(false);
  });

  it("the real H-1 reply (12 'children' + 'are they children or adults?') blocks room allocation until ages are confirmed", async () => {
    const r = await interpretEnquiry(replay(JSON.stringify(LIVE_H1)).sel, HARD_ENQUIRIES[0].text, ctx);
    const ages = r.data.openQuestions.filter((q) => q.topic === "ages");
    expect(ages.length).toBeGreaterThan(0);
    expect(ages.every((q) => q.blocksAllocation)).toBe(true);
  });

  it("the interpreter is told not to guess ages for role words", async () => {
    const { sel, bodies } = replay('{"adults":2}');
    await interpretEnquiry(sel, "2 adults", ctx);
    expect(String(bodies[0].messages[0].content)).toMatch(/do NOT guess/);
  });
});

describe("B · uncertain total keeps the booking provisional", () => {
  it("the real H-2 reply: 'Is gogo included in the 16 or extra?' becomes a count question; 16 may be explored but never approved", async () => {
    const r = await interpretEnquiry(replay(JSON.stringify(LIVE_H2)).sel, HARD_ENQUIRIES[1].text, ctx);
    const count = r.data.openQuestions.find((q) => q.topic === "count");
    expect(count?.text).toBe("Is gogo included in the 16 or extra?");
    expect(count?.blocksAllocation).toBeFalsy(); // provisional options are allowed…
    const req = { checkIn: "2026-11-21", checkOut: "2026-11-24", units: r.data.units };
    const e = pendingApproval(req, r.data.openQuestions);
    expect(canTransition(e, "owner_approve", "owner")).toBe(false); // …approval is not
    expect(() => transition(e, { type: "owner_approve", ownerName: "Owner" }, C("owner"))).toThrow(/Provisional: .*open question/);
  });

  it("once resolved (questions cleared), the owner can approve; confirmation is also blocked while questions are open", () => {
    const req = { checkIn: "2026-11-21", checkOut: "2026-11-24", units: unitsFromExtraction({ adults: 2, couples: 1 }, "x") };
    const open = pendingApproval(req, [{ topic: "count", text: "Is gogo included in the 16 or extra?" }]);
    expect(canTransition({ ...open, status: "awaiting_payment" }, "confirm", "owner")).toBe(false);
    expect(canTransition({ ...open, status: "approved" }, "send_quote", "staff")).toBe(false);
    const resolved = { ...open, openQuestions: [] };
    expect(transition(resolved, { type: "owner_approve", ownerName: "Owner" }, C("owner")).status).toBe("approved");
  });
});

describe("C · accessibility and self-catering are checked on the actual rooms", () => {
  const units = unitsFromExtraction(LIVE_H3 as never, "Annelie");
  const request: StayRequest = { checkIn: "2026-12-14", checkOut: "2026-12-21", units, selfCatering: true };
  const res = allocate(request, { rooms: DEMO_ROOMS, bookings: [] });

  it("the real H-3 allocation: the apartment is ground floor AND self-catering (both actually met)", () => {
    const apt = DEMO_ROOMS.find((r) => r.id === res.options[0].assignments[0].roomId)!;
    expect(apt.selfCatering).toBe(true);
    expect(apt.floor).toBe("ground");
  });

  it("…and nobody who cannot climb is put on a TOP bunk: the adult is on the bottom bunk, a child on top — no owner-review issue", () => {
    const apt = res.options[0].assignments[0];
    expect(apt.sleeping.some((l) => /^Bunk\d* \(bottom\).*\(adult\)/.test(l))).toBe(true);
    expect(apt.sleeping.some((l) => /^Bunk\d* \(top\).*\(adult\)/.test(l))).toBe(false);
    expect(requirementIssues(res.options[0], units, DEMO_ROOMS, { selfCatering: true })).toEqual([]);
  });

  it("an adult on a TOP bunk in a room with a 'no stairs' guest is flagged for owner review", () => {
    const o = { ...res.options[0], assignments: [{ ...res.options[0].assignments[0], sleeping: ["Bunk (top) — Annelie family (adult)", "Bunk (bottom) — Annelie family (child)"] }] };
    expect(requirementIssues(o, units, DEMO_ROOMS, { selfCatering: true }).join(" ")).toMatch(/adult must sleep on a top bunk .* owner to confirm who sleeps where/);
  });

  it("self-catering is never implied: an option without a kitchen is flagged", () => {
    const couple = unitsFromExtraction({ adults: 2, couples: 1 }, "x");
    const o = allocate({ checkIn: "2026-12-14", checkOut: "2026-12-16", units: couple }, { rooms: DEMO_ROOMS.filter((r) => !r.selfCatering), bookings: [] }).options[0];
    expect(requirementIssues(o, couple, DEMO_ROOMS, { selfCatering: true })).toContain("Self-catering was requested but this option has no room with a kitchen — owner to review with the guest");
  });

  it("a requirement limitation locks approval until the owner resolves it", () => {
    const e = pendingApproval(request, [{ topic: "requirement", text: "Self-catering was requested but this option has no room with a kitchen — owner to review with the guest" }]);
    expect(canTransition(e, "owner_approve", "owner")).toBe(false);
  });
});

describe("Response quality (offline, with the real Stage 4 texts)", () => {
  it("no duplicate questions: H-1's two stay-length questions merge; the coaches' room preference is not asked while critical questions are open", async () => {
    const r = await interpretEnquiry(replay(JSON.stringify(LIVE_H1)).sel, HARD_ENQUIRIES[0].text, ctx);
    const qs = guestQuestionsFrom(r.data.openQuestions);
    expect(qs.filter((q) => /night|date/i.test(q))).toHaveLength(1);
    expect(qs.some((q) => /own rooms/i.test(q))).toBe(false);
    expect(qs).toContain("How many of the group are adults, and how many are children (under 18)?");
    expect(new Set(qs).size).toBe(qs.length);
    expect(topicOf("Do the two coaches need their own rooms?")).toBe("preference");
  });

  it("staff see one item per topic (dates, ages), not six overlapping notes", async () => {
    const r = await interpretEnquiry(replay(JSON.stringify(LIVE_H1)).sel, HARD_ENQUIRIES[0].text, ctx);
    const topics = r.data.openQuestions.map((q) => q.topic);
    expect(topics.filter((t) => t === "dates")).toHaveLength(1);
    expect(topics.filter((t) => t === "ages")).toHaveLength(1);
    expect(r.data.openQuestions.find((q) => q.topic === "ages")?.blocksAllocation).toBe(true);
    expect(r.data.openQuestions.find((q) => q.topic === "dates")?.text).toMatch(/Friday after next/);
  });

  it("explanations always mention accessibility: the real E1 text omitted it, so the app appends the engine's facts (labelled)", async () => {
    const units = unitsFromExtraction({ checkIn: "2026-11-21", checkOut: "2026-11-23", adults: 14, couples: 4, drivers: 1, wheelchairUsers: 1 }, "Lindiwe");
    const res = allocate({ checkIn: "2026-11-21", checkOut: "2026-11-23", units }, { rooms: DEMO_ROOMS, bookings: [] });
    const facts = accessibilityFacts(res.options, units, DEMO_ROOMS);
    expect(facts[0]).toMatch(/Couple 1 \(wheelchair user\) in Room 1 · Accessible Triple — wheelchair accessible, ground floor/);
    const { sel, bodies } = replay(LIVE_E1);
    const e = await explainOptions(sel, { guestName: "Lindiwe", options: res.options, comparison: res.comparison ?? "", roomNames: {}, accessibility: facts });
    expect(JSON.parse(bodies[0].messages[1].content).accessibility).toEqual(facts);
    expect(e.source).toBe("meta");
    expect(e.data).toMatch(/Accessibility: Option A: Couple 1 \(wheelchair user\)/);
    expect(e.fallbackReason).toMatch(/Accessibility facts added by the app/);
  });

  it("greeting prompt no longer invites 'the option you asked about'", async () => {
    const { sel, bodies } = replay("Hello Lindiwe, thank you for your enquiry. Your proposed rooms and quotation follow below for your review.");
    await draftQuoteIntro(sel, { guestName: "Lindiwe", checkIn: "2026-11-21", checkOut: "2026-11-23", optionTitle: "Option A", roomNames: [], notes: [], propertyName: DEMO_PROPERTY.name });
    expect(String(bodies[0].messages[0].content)).toMatch(/Do not say they chose or asked for a specific option/);
  });
});
