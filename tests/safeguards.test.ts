import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { allocate } from "@/lib/allocation/engine";
import { DEMO_PROPERTY, DEMO_ROOMS } from "@/lib/data/property";
import { createDemoEnquiries } from "@/lib/data/demoEnquiries";
import { buildQuote } from "@/lib/quote/pricing";
import { transition, type TransitionContext } from "@/lib/workflow/stateMachine";
import { validateExtraction, headcountMentioned } from "@/lib/enquiry/extraction";
import { MetaAIProvider } from "@/lib/ai/metaProvider";
import { SimulationProvider } from "@/lib/ai/simulationProvider";
import { CallBudget } from "@/lib/ai/budget";
import { interpretEnquiry, explainOptions, draftQuoteIntro, containsPriceTalk, type ProviderSelection } from "@/lib/ai/service";
import type { LiveAIConfig } from "@/lib/ai/config";
import type { Booking, Enquiry } from "@/lib/domain/types";

/*
 * Booking safeguards: whatever the language model says, it cannot create availability, change
 * capacities or prices, confirm bookings, record payments, or receive private data.
 * All model replies here are mocked; no network is used.
 */

const ctx = { propertyName: DEMO_PROPERTY.name, today: "2026-11-01" };
const live: LiveAIConfig = {
  provider: "meta-model-api", label: "Meta Model API", hostLabel: "Meta", baseUrl: "https://api.meta.ai/v1",
  apiKey: "test-key-not-real", model: "muse-spark-1.3", jsonMode: "prompt", timeoutMs: 5000, maxRetries: 0,
  maxOutputTokens: 800, reasoningEffort: "minimal",
};

function mocked(content: string) {
  const bodies: Record<string, unknown>[] = [];
  const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    return new Response(JSON.stringify({ id: "resp_mock", model: "muse-spark-1.3", choices: [{ message: { content }, finish_reason: "stop" }], usage: { prompt_tokens: 250, completion_tokens: 300, completion_tokens_details: { reasoning_tokens: 200 } } }), { status: 200 });
  }) as unknown as typeof fetch;
  const simulation = new SimulationProvider();
  const sel: ProviderSelection = {
    primary: new MetaAIProvider(live, { fetchImpl, sleep: async () => {} }),
    simulation,
    config: { mode: "meta-model-api", issues: [], warnings: [] },
    budget: new CallBudget(100),
  };
  return { sel, bodies };
}

const ALLOWED_KEYS = ["guestName", "checkIn", "checkOut", "nights", "adults", "children", "couples", "families", "drivers", "groupLeaders", "wheelchairUsers", "groundFloorGuests", "separateBeds", "selfCatering", "notes"];

describe("AI cannot invent availability, capacity, prices, bookings or payments", () => {
  const hostile = JSON.stringify({
    checkIn: "2026-12-11", checkOut: "2026-12-13", adults: 4,
    available: true, availableRooms: ["r1", "r2", "r3"], rooms: [{ id: "r7", capacity: 10 }], capacity: 40,
    price: 100, total: 1, ratePerNight: 50, discountPercent: 90, deposit: 0,
    status: "confirmed", bookingConfirmed: true, paymentReceived: true, paid: 99999,
  });

  it("validation keeps only booking-request fields; availability, price, status and payment claims are dropped", () => {
    const check = validateExtraction(JSON.parse(hostile));
    for (const k of Object.keys(check.value)) expect(ALLOWED_KEYS).toContain(k);
    expect(check.value).not.toHaveProperty("available");
    expect(check.value).not.toHaveProperty("price");
    expect(check.value).not.toHaveProperty("status");
    expect(check.value).not.toHaveProperty("paymentReceived");
  });

  it("availability comes only from bookings: a model claiming free rooms cannot fill a fully booked date", async () => {
    const { sel } = mocked(hostile);
    const r = await interpretEnquiry(sel, "4 adults 11-13 December, are rooms available?", ctx);
    expect(r.source).toBe("meta");
    const allBooked: Booking[] = DEMO_ROOMS.map((room, i) => ({ id: `B-${i}`, roomId: room.id, guestName: "Existing guest", checkIn: "2026-12-10", checkOut: "2026-12-14", guests: 1, kind: "booking" }) satisfies Booking);
    const res = allocate({ checkIn: "2026-12-11", checkOut: "2026-12-13", units: r.data.units }, { rooms: DEMO_ROOMS, bookings: allBooked, suggestDates: false });
    expect(res.ok).toBe(false);
    expect(res.options).toHaveLength(0);
  });

  it("room capacities and rates are unchanged by a model reply, and rooms are never over capacity", async () => {
    const before = JSON.stringify(DEMO_ROOMS);
    const { sel } = mocked(hostile);
    const r = await interpretEnquiry(sel, "4 adults 11-13 December", ctx);
    expect(JSON.stringify(DEMO_ROOMS)).toBe(before);
    const res = allocate({ checkIn: "2026-12-11", checkOut: "2026-12-13", units: r.data.units }, { rooms: DEMO_ROOMS, bookings: [] });
    for (const o of res.options) for (const a of o.assignments) expect(a.guests).toBeLessThanOrEqual(DEMO_ROOMS.find((x) => x.id === a.roomId)!.capacity);
  });

  it("prices come only from the deterministic quote, whatever the model said", async () => {
    const { sel } = mocked(hostile);
    const r = await interpretEnquiry(sel, "4 adults 11-13 December", ctx);
    const request = { checkIn: "2026-12-11", checkOut: "2026-12-13", units: r.data.units };
    const option = allocate(request, { rooms: DEMO_ROOMS, bookings: [] }).options[0];
    const q = buildQuote({ id: "Q", enquiryId: "E", guestName: "Test", request, option, property: DEMO_PROPERTY, now: "2026-11-01T00:00:00Z" });
    expect(q.total).toBeGreaterThan(1000); // not the model's "total": 1
    expect(q.discountPercent).not.toBe(90);
    expect(q.deposit).toBeGreaterThan(0);
  });

  it("AI wording that talks about prices is replaced: option explanations and quote greetings", async () => {
    const opt = allocate({ checkIn: "2026-12-11", checkOut: "2026-12-13", units: [{ id: "u", label: "Couple", kind: "couple", adults: 2, children: 0, couples: 1, separateBeds: false, privateRoom: false, access: "none" }] }, { rooms: DEMO_ROOMS, bookings: [] }).options;
    const e = await explainOptions(mocked("Option A is cheaper at R1 100 per night with a 50% discount.").sel, { guestName: "Test", options: opt, comparison: "", roomNames: {} });
    expect(e.source).toBe("simulation");
    expect(e.fallbackReason).toMatch(/mentioned prices/);
    const d = await draftQuoteIntro(mocked("Great news, your rooms are only R500 a night!").sel, { guestName: "Test", checkIn: "2026-12-11", checkOut: "2026-12-13", optionTitle: "A", roomNames: [], notes: [], propertyName: DEMO_PROPERTY.name });
    expect(d.source).toBe("simulation");
    expect(containsPriceTalk("Room 2 suits the 3 friends; Option B gives the couple privacy.")).toBe(false);
  });

  it("the AI layer has no code path to the booking workflow (no transitions, approvals or payments)", () => {
    const files = [
      ...fs.readdirSync(path.resolve(__dirname, "../src/lib/ai")).map((f) => path.join("../src/lib/ai", f)),
      ...["interpret", "explain", "draft", "test", "status", "catalog"].map((r) => `../src/app/api/ai/${r}/route.ts`),
    ];
    for (const f of files) {
      const src = fs.readFileSync(path.resolve(__dirname, f), "utf8");
      expect(src, f).not.toMatch(/workflow\/stateMachine|\btransition\(|"record_payment"|"owner_approve"|type: "confirm"/);
    }
  });

  it("a booking cannot be confirmed or paid without the owner, even after an AI interpretation", () => {
    const request = { checkIn: "2026-12-11", checkOut: "2026-12-13", units: [{ id: "u", label: "Couple", kind: "couple" as const, adults: 2, children: 0, couples: 1, separateBeds: false, privateRoom: false, access: "none" as const }] };
    const option = allocate(request, { rooms: DEMO_ROOMS, bookings: [] }).options[0];
    const quote = buildQuote({ id: "Q", enquiryId: "E", guestName: "Test", request, option, property: DEMO_PROPERTY, now: "2026-11-01T00:00:00Z" });
    const c = (actor: TransitionContext["actor"]): TransitionContext => ({ actor, rooms: DEMO_ROOMS, bookings: [], depositPercent: DEMO_PROPERTY.depositPercent, now: "2026-11-02T00:00:00Z" });
    let e: Enquiry = { id: "E", guestName: "Test", phone: "+27 00 000 0000", channel: "whatsapp", receivedAt: "2026-11-01T00:00:00Z", messages: [], status: "enquiry", request, events: [] };
    e = transition(e, { type: "create_draft", quote }, c("staff"));
    e = transition(e, { type: "submit_for_approval" }, c("staff"));
    expect(() => transition(e, { type: "send_quote" }, c("staff"))).toThrow();
    expect(() => transition(e, { type: "owner_approve", ownerName: "x" }, c("staff"))).toThrow(/owner/);
    expect(() => transition(e, { type: "owner_approve", ownerName: "x" }, c("system"))).toThrow(/owner/);
    expect(() => transition(e, { type: "confirm" }, c("owner"))).toThrow();
    e = transition(e, { type: "owner_approve", ownerName: "Owner" }, c("owner"));
    e = transition(e, { type: "send_quote" }, c("staff"));
    e = transition(e, { type: "guest_accept" }, c("guest"));
    e = transition(e, { type: "request_payment" }, c("system"));
    const pay = { simulated: true as const, reference: "SIM", amount: quote.deposit, receivedAt: "2026-11-03T00:00:00Z" };
    expect(() => transition(e, { type: "record_payment", payment: pay }, c("system"))).toThrow(/owner/);
    expect(() => transition(e, { type: "record_payment", payment: pay }, c("staff"))).toThrow(/owner/);
    expect(() => transition(e, { type: "confirm" }, c("system"))).toThrow(); // no payment recorded
  });
});

describe("AI cannot silently undercount a group", () => {
  // The reply Muse Spark 1.3 actually returned on 1 Nov 2026 (live call 1): it left out the total adults.
  const LIVE_REPLY = '{"guestName": "Naledi", "checkIn": "2026-12-11", "checkOut": "2026-12-13", "nights": 2, "groupLeaders": 2, "wheelchairUsers": 1, "separateBeds": true, "notes": ["netball club tournament", "12 players happy to share rooms", "2 coaches need own rooms"]}';
  const TEXT = "Our netball club is coming for a tournament: 12 players and 2 coaches, arriving Friday 11 December 2026 and leaving Sunday 13 December.";

  it("replaying the real live reply: staff are asked to confirm the total instead of quoting for 2", async () => {
    const r = await interpretEnquiry(mocked(LIVE_REPLY).sel, TEXT, ctx);
    expect(r.data.check.value.adults).toBe(2);
    expect(r.data.check.missing.join(" ")).toMatch(/confirmed total number of adults/);
    expect(r.data.check.missing.join(" ")).toMatch(/mentions 14 people but the interpretation has 2/);
  });

  it("headcount hints are read from the message deterministically", () => {
    expect(headcountMentioned("12 players and 2 coaches")).toBe(14);
    expect(headcountMentioned("9 players who need separate beds, 1 coach and a driver")).toBe(10);
    expect(headcountMentioned("2 adults and 3 children")).toBe(5);
    expect(headcountMentioned("12 players and 2 coaches. The 2 coaches need their own rooms")).toBe(14);
    expect(headcountMentioned("a church choir of 14 adults, 4 couples")).toBe(14);
    expect(headcountMentioned("arriving 11 December for 3 nights")).toBeUndefined();
  });

  it("an interpretation of 12 for '12 players and 2 coaches' is flagged (found in rehearsal)", async () => {
    const r = await interpretEnquiry(mocked('{"checkIn":"2026-12-11","checkOut":"2026-12-13","adults":12,"groupLeaders":2}').sel, TEXT, ctx);
    expect(r.data.check.missing.join(" ")).toMatch(/mentions 14 people but the interpretation has 12/);
  });

  it("no false alarms on the seeded demo enquiries when the count is right", async () => {
    const { enquiries } = createDemoEnquiries("2026-11-01", [], new Date("2026-11-01T08:00:00Z"));
    for (const e of enquiries) {
      const r = await interpretEnquiry({ primary: new SimulationProvider(), simulation: new SimulationProvider(), config: { mode: "simulation", issues: [], warnings: [] } }, e.messages[0].text, ctx);
      const total = (r.data.check.value.adults ?? 0) + (r.data.check.value.children ?? 0);
      const mentioned = headcountMentioned(e.messages[0].text);
      if (mentioned === undefined || mentioned <= total) expect(r.data.check.missing.join(" "), e.id).not.toMatch(/guest count to confirm/);
    }
  });
});

describe("private data stays out of model requests", () => {
  it("only the message text, property name and date are sent for interpretation; never phone numbers or other guests", async () => {
    const { enquiries } = createDemoEnquiries("2026-11-01", [], new Date("2026-11-01T08:00:00Z"));
    const target = enquiries[0];
    const { sel, bodies } = mocked('{"adults":2}');
    await interpretEnquiry(sel, target.messages[0].text, ctx);
    const sent = JSON.stringify(bodies[0]);
    for (const e of enquiries) {
      expect(sent).not.toContain(e.phone.replace(" (fictional)", ""));
      if (e.id !== target.id) expect(sent).not.toContain(e.messages[0].text.slice(0, 40));
    }
    expect(sent).not.toContain("test-key-not-real"); // the key travels only in the Authorization header
    expect(bodies[0].max_tokens).toBe(800);
    expect(bodies[0].reasoning_effort).toBe("minimal");
  });

  it("records token usage from the response for cost tracking", async () => {
    const r = await interpretEnquiry(mocked('{"adults":2}').sel, "2 adults", ctx);
    expect(r.call?.usage).toEqual({ promptTokens: 250, completionTokens: 300, reasoningTokens: 200 });
  });
});
