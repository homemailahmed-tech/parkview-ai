import { describe, expect, it, vi } from "vitest";
import { headcountAnalysis } from "@/lib/enquiry/extraction";
import { interpretEnquiry, type ProviderSelection } from "@/lib/ai/service";
import { MetaAIProvider } from "@/lib/ai/metaProvider";
import { SimulationProvider } from "@/lib/ai/simulationProvider";
import { CallBudget } from "@/lib/ai/budget";
import { allocate } from "@/lib/allocation/engine";
import { DEMO_PROPERTY, DEMO_ROOMS } from "@/lib/data/property";
import { buildQuote } from "@/lib/quote/pricing";
import { canTransition, quoteStaleReasons, transition, type TransitionContext } from "@/lib/workflow/stateMachine";
import { detectExclusiveUse, packageAvailability, packageFromAnswer, packageRooms, EXCLUSIVE_QUESTION_PREFIX } from "@/lib/enquiry/exclusiveUse";
import { resolveOpenQuestions, ResolutionError } from "@/lib/enquiry/openQuestions";
import { unitsFromExtraction } from "@/lib/enquiry/extraction";
import type { Booking, Enquiry, Room, StayRequest } from "@/lib/domain/types";

/* Targeted fixes after the 3 Nov back-test (reconstructed, anonymised cases; fictional demo property).
   Fix 1: corrected guest counts must not be added to the superseded ones.
   Fix 2: an exclusive-use request must never silently become an ordinary room quote. */

// Genuine Muse Spark readings of the anonymised cases B and C from the private 3 Nov validation run, replayed offline.
const LIVE_B = '{"checkIn":"2025-12-27","checkOut":"2025-12-30","nights":3,"adults":2,"children":3,"families":[{"adults":2,"children":3}],"notes":["requests two rooms"]}';
const LIVE_C = '{"checkIn":"2025-12-24","checkOut":"2025-12-29","nights":5,"adults":10,"notes":["Requests exclusive use of whole guest house"]}';
const CASE_B = "Hi, accommodation for 2 adults and 2 children please, 27 to 30 December.\nSorry, correction: we are 2 adults and 3 children, ages 4, 8 and 14.\nCan we have two rooms if possible?";
const CASE_C = "Hi, we are 10 adults and would like to book the whole guest house just for us from 24 to 29 December. What would it cost?";
const sel = (content: string): ProviderSelection => ({
  primary: new MetaAIProvider({ provider: "meta-model-api", label: "Meta Model API", hostLabel: "Meta", baseUrl: "https://api.meta.ai/v1", apiKey: "replay-not-real", model: "muse-spark-1.3", jsonMode: "prompt", timeoutMs: 5000, maxRetries: 0, maxOutputTokens: 1100 }, { fetchImpl: vi.fn(async () => new Response(JSON.stringify({ id: "r", model: "muse-spark-1.3", choices: [{ message: { content }, finish_reason: "stop" }] }), { status: 200 })) as unknown as typeof fetch, sleep: async () => {} }),
  simulation: new SimulationProvider(), config: { mode: "meta-model-api", issues: [], warnings: [] }, budget: new CallBudget(10),
});
const ctx = { today: "2025-12-01", propertyName: "Parkside Demo Guest House" };
const C = (actor: TransitionContext["actor"]): TransitionContext => ({ actor, rooms: DEMO_ROOMS, bookings: [], depositPercent: DEMO_PROPERTY.depositPercent, now: "2025-12-01T00:00:00Z" });
const booking = (roomId: string, checkIn: string, checkOut: string): Booking => ({ id: `b-${roomId}`, roomId, guestName: "Existing guest", checkIn, checkOut, guests: 1, kind: "booking" });

describe("Fix 1 · corrected guest counts replace earlier ones", () => {
  it("Case B: '2 adults and 2 children' then 'correction: 2 adults and 3 children' counts 5, not 7", () => {
    expect(headcountAnalysis(CASE_B)).toMatchObject({ total: 5, corrected: true, conflicts: [] });
  });

  it("Case B with the genuine Meta reading: no false 'mentions 7 people' question; parties hold 5", async () => {
    const r = await interpretEnquiry(sel(LIVE_B), CASE_B, ctx);
    expect(r.data.check.missing.join(" ")).not.toMatch(/mentions 7/);
    expect(r.data.openQuestions.filter((q) => q.topic === "count")).toEqual([]);
    expect(r.data.units.reduce((s, u) => s + u.adults + u.children, 0)).toBe(5);
  });

  it("a reading that keeps the SUPERSEDED count is still caught (5 stated, 4 interpreted)", async () => {
    const r = await interpretEnquiry(sel('{"checkIn":"2025-12-27","checkOut":"2025-12-30","adults":2,"children":2}'), CASE_B, ctx);
    expect(r.data.check.missing.join(" ")).toMatch(/mentions 5 people but the interpretation has 4/);
  });

  it("different numbers WITHOUT a clear correction are asked about, never summed", async () => {
    const text = "We are 2 adults and 2 children.\nWe are 2 adults and 3 children.";
    expect(headcountAnalysis(text).conflicts).toEqual([{ who: "children", values: [2, 3] }]);
    const r = await interpretEnquiry(sel('{"adults":2,"children":3,"checkIn":"2025-12-27","checkOut":"2025-12-30"}'), text, ctx);
    const m = r.data.check.missing.join(" ");
    expect(m).toMatch(/different numbers for children \(2 and 3\) without a clear correction/);
    expect(m).not.toMatch(/mentions 7/);
    expect(r.data.openQuestions.some((q) => q.topic === "count")).toBe(true);
  });

  it("unrelated numbers (ages, dates, nights, room numbers) are not counted as people", () => {
    expect(headcountAnalysis("2 adults and 3 children, ages 4, 8 and 14, arriving 27 December for 3 nights, room 4 please").total).toBe(5);
  });

  it("existing behaviour kept: different groups add up, repeats count once, in-sentence corrections replace", () => {
    expect(headcountAnalysis("12 players and 2 coaches. The 2 coaches need their own rooms").total).toBe(14);
    expect(headcountAnalysis("We are 14 adults. Correction: now 16 adults.")).toMatchObject({ total: 16, corrected: true, conflicts: [] });
    expect(headcountAnalysis("arriving 11 December for 3 nights").total).toBeUndefined();
  });

  it("never invents ages or sharing: the guard only asks, it does not change the parties", async () => {
    const r = await interpretEnquiry(sel(LIVE_B), CASE_B, ctx);
    expect(r.data.units).toEqual(unitsFromExtraction({ adults: 2, children: 3, families: [{ adults: 2, children: 3 }], checkIn: "2025-12-27", checkOut: "2025-12-30", nights: 3, notes: ["requests two rooms"] }, "Guest"));
  });
});

describe("Fix 2 · exclusive use is a binding requirement", () => {
  it("detects exclusive use; asks Main House vs Whole Property when the package is not stated", () => {
    expect(detectExclusiveUse(CASE_C)).toBe("unspecified");
    expect(detectExclusiveUse("We'd like the whole property including the apartment")).toBe("whole-property");
    expect(detectExclusiveUse("Exclusive use of the main house please, without the apartment")).toBe("main-house");
    expect(detectExclusiveUse("Can we have a room just for us?")).toBeUndefined();
    expect(detectExclusiveUse("10 adults from 24 Dec", ["Requests exclusive use of whole guest house"])).toBe("unspecified");
  });

  it("Case C with the genuine Meta reading: exclusive use is recorded and a blocking package question is raised", async () => {
    const r = await interpretEnquiry(sel(LIVE_C), CASE_C, ctx);
    expect(r.data.exclusiveUse).toBe("unspecified");
    const q = r.data.openQuestions.find((x) => x.text.startsWith(EXCLUSIVE_QUESTION_PREFIX));
    expect(q).toMatchObject({ topic: "requirement", blocksAllocation: true });
  });

  it("the engine never substitutes ordinary rooms for an exclusive-use request", () => {
    const units = unitsFromExtraction({ adults: 10 }, "Group");
    const unspecified = allocate({ checkIn: "2025-12-24", checkOut: "2025-12-29", units, exclusiveUse: "unspecified" }, { rooms: DEMO_ROOMS, bookings: [], today: "2025-12-01" });
    expect(unspecified.ok).toBe(false);
    expect(unspecified.options).toEqual([]);
    expect(unspecified.errors[0]).toMatch(/confirm with the guest whether they want the Main House/);
    const main = allocate({ checkIn: "2025-12-24", checkOut: "2025-12-29", units, exclusiveUse: "main-house" }, { rooms: DEMO_ROOMS, bookings: [], today: "2025-12-01" });
    expect(main.options).toEqual([]);
    expect(main.errors[0]).toMatch(/^Main House .* is available for these dates \(all 8 units free, sleeps up to 23; .*Package pricing is not configured.*Ordinary rooms are not offered/);
    // Without the exclusivity flag the same group gets ordinary room options (no regression).
    expect(allocate({ checkIn: "2025-12-24", checkOut: "2025-12-29", units }, { rooms: DEMO_ROOMS, bookings: [], today: "2025-12-01" }).options.length).toBeGreaterThan(0);
  });

  it("package availability follows the inventory dependency rules (no double counting, existing bookings untouched)", () => {
    const stay = ["2025-12-24", "2025-12-29"] as const;
    const apt = DEMO_ROOMS.find((r) => r.selfCatering)!;
    expect(packageRooms(DEMO_ROOMS, "main-house").length).toBe(8);
    expect(packageRooms(DEMO_ROOMS, "whole-property").length).toBe(9);
    // Apartment booked → Whole Property blocked, Main House still available.
    const aptBooked = [booking(apt.id, "2025-12-25", "2025-12-27")];
    expect(packageAvailability(DEMO_ROOMS, aptBooked, "whole-property", ...stay)).toMatchObject({ available: false, blocked: [apt] });
    expect(packageAvailability(DEMO_ROOMS, aptBooked, "main-house", ...stay).available).toBe(true);
    // One room booked → both packages blocked.
    const roomBooked = [booking("r3", "2025-12-28", "2025-12-30")];
    expect(packageAvailability(DEMO_ROOMS, roomBooked, "main-house", ...stay).available).toBe(false);
    expect(packageAvailability(DEMO_ROOMS, roomBooked, "whole-property", ...stay).available).toBe(false);
    // Checkout day is not an occupied night: same-day turnover is allowed.
    expect(packageAvailability(DEMO_ROOMS, [booking("r3", "2025-12-20", "2025-12-24"), booking(apt.id, "2025-12-29", "2026-01-02")], "whole-property", ...stay).available).toBe(true);
    // The engine reports the blocked unit and does not touch the existing booking.
    const bookings = [...roomBooked];
    const r = allocate({ checkIn: stay[0], checkOut: stay[1], units: unitsFromExtraction({ adults: 10 }, "G"), exclusiveUse: "main-house" }, { rooms: DEMO_ROOMS, bookings, today: "2025-12-01" });
    expect(r.errors[0]).toMatch(/NOT available .* Room 3 .* never moved or cancelled/);
    expect(bookings).toEqual(roomBooked);
  });

  it("a room quote cannot be submitted, approved, sent or confirmed while exclusive use is requested", () => {
    const units = unitsFromExtraction({ adults: 10 }, "Group");
    const req: StayRequest = { checkIn: "2025-12-24", checkOut: "2025-12-29", units };
    const quote = buildQuote({ id: "Q", enquiryId: "E", guestName: "G", request: req, option: allocate(req, { rooms: DEMO_ROOMS, bookings: [], today: "2025-12-01" }).options[0], property: DEMO_PROPERTY });
    let e: Enquiry = { id: "E", guestName: "G", phone: "x", channel: "whatsapp", receivedAt: "t", messages: [], status: "enquiry", request: req, events: [] };
    e = transition(e, { type: "create_draft", quote }, C("staff"));
    const excl = { ...e, request: { ...req, exclusiveUse: "main-house" as const } };
    expect(quoteStaleReasons(excl).join()).toMatch(/requested exclusive use/);
    expect(() => transition(excl, { type: "submit_for_approval" }, C("staff"))).toThrow(/exclusive use/);
    expect(canTransition({ ...excl, status: "pending_approval" }, "owner_approve", "owner")).toBe(false);
  });

  it("recording the guest's answer sets (or clears) the package; vague answers are refused", () => {
    const req: StayRequest = { checkIn: "2025-12-24", checkOut: "2025-12-29", units: unitsFromExtraction({ adults: 10 }, "G"), exclusiveUse: "unspecified" };
    const q = `${EXCLUSIVE_QUESTION_PREFIX} does the guest want the Main House … ?`;
    const base: Enquiry = { id: "E", guestName: "G", phone: "x", channel: "whatsapp", receivedAt: "t", messages: [], status: "enquiry", request: req, events: [], openQuestions: [{ topic: "requirement", text: q, blocksAllocation: true }] };
    const res = (answer: string) => resolveOpenQuestions(base, [{ question: q, answer, source: "whatsapp", confirmedBy: "Staff" }], "staff", "t");
    expect(res("The main house please, we don't need the apartment").request?.exclusiveUse).toBe("main-house");
    expect(res("Whole property, including the apartment").request?.exclusiveUse).toBe("whole-property");
    const none = res("Not exclusive, separate rooms are fine");
    expect(none.request?.exclusiveUse).toBeUndefined();
    expect(none.openQuestions).toEqual([]);
    expect(() => res("not sure yet")).toThrow(ResolutionError);
    expect(packageFromAnswer("ok")).toBeUndefined();
  });
});

describe("Confirmed inventory as TEST configuration (neutral names; the demo identity is unchanged)", () => {
  // Layout confirmed by the owner (3 Nov 2026): 8 en-suite rooms + 1 apartment. Real floors; only Room 1 is accessible;
  // the apartment's double beds are upstairs, so it is modelled as "first" floor for no-stairs guests.
  const floors: Record<string, Room["floor"]> = { r1: "ground", r2: "first", r3: "first", r4: "first", r5: "first", r6: "first", r7: "ground", r8: "ground", apt: "first" };
  const CONFIRMED: Room[] = DEMO_ROOMS.map((r, i) => ({ ...r, name: `Unit ${i + 1}`, floor: floors[r.id], wheelchairAccessible: r.id === "r1" }));

  it("capacities: main house 23, apartment 6, whole property 29; packages are not extra units", () => {
    expect(CONFIRMED.filter((r) => !r.selfCatering).reduce((s, r) => s + r.capacity, 0)).toBe(23);
    expect(CONFIRMED.filter((r) => r.selfCatering).reduce((s, r) => s + r.capacity, 0)).toBe(6);
    expect(packageAvailability(CONFIRMED, [], "whole-property", "2025-12-24", "2025-12-29")).toMatchObject({ capacity: 29, units: 9 });
    expect(packageAvailability(CONFIRMED, [], "main-house", "2025-12-24", "2025-12-29")).toMatchObject({ capacity: 23, units: 8 });
  });

  it("a wheelchair user is only placed in the one accessible room; no-stairs guests never go upstairs", () => {
    const units = unitsFromExtraction({ adults: 6, couples: 2, wheelchairUsers: 1, groundFloorGuests: 1 }, "G");
    const r = allocate({ checkIn: "2025-12-24", checkOut: "2025-12-27", units }, { rooms: CONFIRMED, bookings: [], today: "2025-12-01" });
    expect(r.ok).toBe(true);
    for (const o of r.options) {
      for (const a of o.assignments) {
        const room = CONFIRMED.find((x) => x.id === a.roomId)!;
        const needs = a.unitIds.map((id) => units.find((u) => u.id === id)!.access);
        if (needs.includes("wheelchair")) expect(room.id).toBe("r1");
        if (needs.includes("ground-floor")) expect(room.floor).toBe("ground");
      }
    }
  });
});
