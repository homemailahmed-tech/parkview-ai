import { describe, expect, it, vi } from "vitest";
import { HARD_ENQUIRIES } from "@/lib/data/hardEnquiries";
import { interpretEnquiry, containsFigures, containsPriceTalk, type ProviderSelection } from "@/lib/ai/service";
import { violatesClarificationRules } from "@/lib/ai/clarify";
import { MetaAIProvider } from "@/lib/ai/metaProvider";
import { SimulationProvider } from "@/lib/ai/simulationProvider";
import { CallBudget } from "@/lib/ai/budget";
import { allocate } from "@/lib/allocation/engine";
import { DEMO_PROPERTY, DEMO_ROOMS } from "@/lib/data/property";
import { buildQuote, nightlyRoomRate } from "@/lib/quote/pricing";
import { transition, type TransitionContext } from "@/lib/workflow/stateMachine";
import { selectProvider } from "@/lib/ai/service";
import type { Enquiry } from "@/lib/domain/types";

/*
 * REAL Muse Spark 1.3 / Muse Voice Transcribe outputs from the Stage 4 live run (1 Nov 2026,
 * https://api.meta.ai/v1; evidence in docs/evidence/stage4-live-evidence.json), replayed offline
 * through the deterministic guards, booking engine and approval workflow. No network here.
 */
const LIVE = {
  "H-1": { id: "chatcmpl-01a196ca-431f-7135-8e45-1d075d119d1c", value: { guestName: "Thandeka", checkIn: "2026-11-13", adults: 3, children: 12, drivers: 1, groundFloorGuests: 1, notes: ["One coach uses crutches, needs no stairs"], clarifications: ["Are the 12 netball girls children or adults?", "Confirm staying two nights and check-out date?", "Do the two coaches need their own rooms?"] } },
  "H-2": { id: "chatcmpl-01a196ca-5433-7475-bc51-0245bc1f65c5", value: { guestName: "Mpho", checkIn: "2026-11-21", checkOut: "2026-11-24", nights: 3, adults: 16, couples: 4, groundFloorGuests: 1, separateBeds: true, notes: ["Group size changed from 14 to 16", "Gogo cannot do stairs, needs ground floor"], clarifications: ["Is gogo included in the 16 or extra?", "Are all 16 guests adults, any children?"] } },
  "H-3": { id: "chatcmpl-01a196ca-5fed-7183-aa37-fb212d1e509c", value: { guestName: "Annelie", checkIn: "2026-12-14", checkOut: "2026-12-21", nights: 7, adults: 3, children: 3, groundFloorGuests: 1, selfCatering: true, families: [{ adults: 3, children: 3 }], notes: ["Grandmother cannot climb stairs"] } },
} as const;
const C1 = "Hello Thandeka, thank you for your message!\nCould you please confirm your exact arrival date and how many nights you will stay?\nAre the 12 netball girls children or adults?\nCould you confirm if you are staying two nights and what your check-out date would be?\nDo the two coaches need their own rooms?";
const E1 = "Hi Lindiwe, here are two options for the group.\nOption A is the most efficient setup, with Couple 3 and Couple 4 sharing the Family Room, and Guest 2, Guest 3 and Guest 4 together in the Courtyard Triple.\nOption B offers more privacy and comfort, giving most couples and singles their own rooms, with only Guest 3 and Guest 4 sharing in the Private Entrance Triple.\nDriver 1 stays in the Ground Floor Double in both options.";
const G1 = "Hello Lindiwe, thank you so much for considering Parkside Demo Guest House! We're delighted to share the option you asked about below. Please have a look and let us know what you think.";
const V1 = "Hello, we have 12 ball girls, two coaches and the bus driver arriving on the 13th of November for nights, one coach cannot use stairs..";
const V2 = "hello. We We have well little girls two coaches and the bus driver arriving on the 13th of November for tonights one coach cannot use stairs.";

const ctx = { today: "2026-11-01", propertyName: DEMO_PROPERTY.name };
function replay(value: unknown): ProviderSelection {
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ id: "replay", model: "muse-spark-1.3", choices: [{ message: { content: JSON.stringify(value) }, finish_reason: "stop" }] }), { status: 200 })) as unknown as typeof fetch;
  return { primary: new MetaAIProvider({ provider: "meta-model-api", label: "Meta Model API", hostLabel: "Meta", baseUrl: "https://api.meta.ai/v1", apiKey: "replay-not-real", model: "muse-spark-1.3", jsonMode: "prompt", timeoutMs: 5000, maxRetries: 0, maxOutputTokens: 1200 }, { fetchImpl, sleep: async () => {} }), simulation: new SimulationProvider(), config: { mode: "meta-model-api", issues: [], warnings: [] }, budget: new CallBudget(10) };
}
const roomOf = (id: string) => DEMO_ROOMS.find((r) => r.id === id)!;

describe("Stage 4 live outputs: the guards still hold", () => {
  it("H-1 (relative date, 'might' two nights): dates must be confirmed and check-out is missing — no quote can be built yet", async () => {
    const r = await interpretEnquiry(replay(LIVE["H-1"].value), HARD_ENQUIRIES[0].text, ctx);
    expect(r.data.check.value.checkIn).toBe("2026-11-13"); // Friday after next from Sunday 1 Nov
    expect(r.data.check.value.checkOut).toBeUndefined();
    expect(r.data.check.missing.join(" | ")).toMatch(/dates to confirm with the guest: they wrote "Friday after next"/);
    expect(r.data.check.missing).toContain("check-out date or number of nights");
    expect(r.data.units.reduce((s, u) => s + u.adults + u.children, 0)).toBe(15);
  });

  it("H-2 (correction + ambiguous 17th guest): the question is kept, 16 are allocated within capacity, ground floor honoured", async () => {
    const r = await interpretEnquiry(replay(LIVE["H-2"].value), HARD_ENQUIRIES[1].text, ctx);
    expect(r.data.check.missing).toContain("to clarify: Is gogo included in the 16 or extra?");
    const req = { checkIn: r.data.check.value.checkIn!, checkOut: r.data.check.value.checkOut!, units: r.data.units };
    const res = allocate(req, { rooms: DEMO_ROOMS, bookings: [] });
    expect(res.ok).toBe(true);
    for (const o of res.options) {
      expect(o.totalGuests).toBe(16); // never silently 17
      for (const a of o.assignments) expect(a.guests).toBeLessThanOrEqual(roomOf(a.roomId).capacity);
      const ground = r.data.units.filter((u) => u.access !== "none");
      for (const u of ground) expect(roomOf(o.assignments.find((a) => a.unitIds.includes(u.id))!.roomId).floor).toBe("ground");
    }
  });

  it("H-3 (Afrikaans): booked within capacity; prices come only from the room table; the owner must approve; payment needs the owner", async () => {
    const r = await interpretEnquiry(replay(LIVE["H-3"].value), HARD_ENQUIRIES[2].text, ctx);
    expect(r.data.check.missing).toEqual([]);
    const req = { checkIn: "2026-12-14", checkOut: "2026-12-21", units: r.data.units };
    const option = allocate(req, { rooms: DEMO_ROOMS, bookings: [] }).options[0];
    for (const a of option.assignments) expect(a.guests).toBeLessThanOrEqual(roomOf(a.roomId).capacity);
    const q = buildQuote({ id: "Q", enquiryId: "E", guestName: "Annelie", request: req, option, property: DEMO_PROPERTY, now: "2026-11-01T00:00:00Z" });
    expect(q.lines.every((l) => l.nightlyRate === nightlyRoomRate(roomOf(l.roomId), l.guests))).toBe(true);
    const c = (actor: TransitionContext["actor"]): TransitionContext => ({ actor, rooms: DEMO_ROOMS, bookings: [], depositPercent: DEMO_PROPERTY.depositPercent, now: "2026-11-02T00:00:00Z" });
    let e: Enquiry = { id: "E", guestName: "Annelie", phone: "+27 00 000 0000", channel: "whatsapp", receivedAt: "2026-11-01T00:00:00Z", messages: [], status: "enquiry", request: req, events: [] };
    e = transition(e, { type: "create_draft", quote: q }, c("system"));
    e = transition(e, { type: "submit_for_approval" }, c("system"));
    expect(() => transition(e, { type: "owner_approve", ownerName: "AI" }, c("system"))).toThrow(/owner/);
  });

  it("C1, E1, G1: the live texts contain no prices, availability claims or booking promises", () => {
    expect(violatesClarificationRules(C1)).toBeUndefined();
    expect(containsPriceTalk(E1)).toBe(false);
    expect(containsFigures(G1)).toBe(false);
  });
});

describe("Stage 4 live voice transcripts (synthetic speech): errors are caught downstream, not trusted", () => {
  it("V1 lost 'two' nights and 'net'ball: the deterministic reader asks for the stay length instead of guessing", async () => {
    const r = await interpretEnquiry(selectProvider({}), V1, ctx);
    expect(r.data.check.value.nights).toBeUndefined();
    expect(r.data.check.missing).toContain("check-out date or number of nights");
  });
  it("V2 lost 'twelve': the girls are not counted, and the total must be confirmed by staff", async () => {
    const r = await interpretEnquiry(selectProvider({}), V2, ctx);
    const total = (r.data.check.value.adults ?? 0) + (r.data.check.value.children ?? 0);
    expect(total).toBeLessThan(15);
    expect(r.data.check.missing.join(" | ")).toMatch(/number of adults|total number of adults|guest count/);
  });
});
