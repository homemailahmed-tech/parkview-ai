import { describe, expect, it } from "vitest";
import { allocate } from "@/lib/allocation/engine";
import { DEMO_PROPERTY, DEMO_ROOMS, createDemoBookings } from "@/lib/data/property";
import { buildQuote, reviseQuote } from "@/lib/quote/pricing";
import { bookingsForConfirmed, canTransition, quoteStaleReasons, transition, type TransitionContext, type WorkflowAction } from "@/lib/workflow/stateMachine";
import { unitsFromExtraction } from "@/lib/enquiry/extraction";
import { createDemoEnquiries } from "@/lib/data/demoEnquiries";
import type { Enquiry, StayRequest } from "@/lib/domain/types";

/* Quote integrity. Found after the Stage 5 live choir run: Muse Spark left the adults unstated, the
   parties held 8 of 16 guests, a provisional quote was built for 8, and once the parties were corrected
   to 16 the 8-guest quote could still be approved. A quote must match the CURRENT booking requirements
   before it is submitted, approved, sent or confirmed. */

const C = (actor: TransitionContext["actor"]): TransitionContext => ({ actor, rooms: DEMO_ROOMS, bookings: [], depositPercent: DEMO_PROPERTY.depositPercent, now: "2026-11-02T00:00:00Z" });
const req = (units: StayRequest["units"], checkIn = "2026-11-21", checkOut = "2026-11-24"): StayRequest => ({ checkIn, checkOut, units });
const R8 = req(unitsFromExtraction({ adults: 8, couples: 4 }, "Mpho"));
const R16 = req(unitsFromExtraction({ adults: 16, couples: 4 }, "Mpho"));
const PAY = (amount: number): WorkflowAction => ({ type: "record_payment", payment: { simulated: true, reference: "SIM-1", amount, receivedAt: "2026-11-02T00:00:00Z" } });

function quoted(r: StayRequest) {
  return buildQuote({ id: "Q-1", enquiryId: "E", guestName: "Mpho", request: r, option: allocate(r, { rooms: DEMO_ROOMS, bookings: [] }).options[0], property: DEMO_PROPERTY, now: "2026-11-01T00:00:00Z" });
}
/** Runs the normal workflow on `r` up to `upTo` (inclusive). */
function at(r: StayRequest, upTo: "pending_approval" | "approved" | "awaiting_payment_paid"): Enquiry {
  let e: Enquiry = { id: "E", guestName: "Mpho", phone: "+27 00 000 0000", channel: "whatsapp", receivedAt: "2026-11-01T00:00:00Z", messages: [], status: "enquiry", request: r, events: [] };
  e = transition(e, { type: "create_draft", quote: quoted(r) }, C("staff"));
  e = transition(e, { type: "submit_for_approval" }, C("staff"));
  if (upTo === "pending_approval") return e;
  e = transition(e, { type: "owner_approve", ownerName: "Owner" }, C("owner"));
  if (upTo === "approved") return e;
  e = transition(e, { type: "send_quote" }, C("staff"));
  e = transition(e, { type: "guest_accept" }, C("guest"));
  e = transition(e, { type: "request_payment" }, C("staff"));
  return transition(e, PAY(e.quote!.deposit), C("owner"));
}
const STALE = /Quote is out of date: .*Choose room options again/;

describe("quote integrity: a quote must match the current guest parties and dates", () => {
  it("1 · quoted for 8, parties corrected to 16 → owner approval blocked (and the button is disabled)", () => {
    const e = { ...at(R8, "pending_approval"), request: R16 };
    expect(quoteStaleReasons(e)).toEqual(["guest count changed (quote for 8, parties now 16)"]);
    expect(() => transition(e, { type: "owner_approve", ownerName: "Owner" }, C("owner"))).toThrow(STALE);
    expect(canTransition(e, "owner_approve", "owner")).toBe(false);
  });

  it("2 · approved for 8, parties corrected to 16 → sending blocked", () => {
    const e = { ...at(R8, "approved"), request: R16 };
    expect(() => transition(e, { type: "send_quote" }, C("staff"))).toThrow(/guest count changed \(quote for 8, parties now 16\)/);
    expect(canTransition(e, "send_quote", "staff")).toBe(false);
  });

  it("3 · paid deposit for 8, parties corrected to 16 → confirmation blocked; no booking is created", () => {
    const e = { ...at(R8, "awaiting_payment_paid"), request: R16 };
    expect(() => transition(e, { type: "confirm" }, C("owner"))).toThrow(STALE);
    expect(bookingsForConfirmed(e)).toEqual([]);
  });

  it("4 · after recalculating for 16 (a new quote version), normal approval succeeds", () => {
    const stale = { ...at(R8, "pending_approval"), request: R16 };
    const v2 = { ...quoted(R16), version: stale.quote!.version + 1 };
    let e = transition(stale, { type: "revise_draft", quote: v2 }, C("staff"));
    expect(e.approval).toBeUndefined();
    e = transition(e, { type: "submit_for_approval" }, C("staff"));
    e = transition(e, { type: "owner_approve", ownerName: "Owner" }, C("owner"));
    expect(e.status).toBe("approved");
    expect(e.quote!.lines.reduce((s, l) => s + l.guests, 0)).toBe(16);
  });

  it("5 · same total (16) but adults/children changed → blocked; renaming a party is not material", () => {
    const base = at(R16, "pending_approval");
    const mixed = req(unitsFromExtraction({ adults: 14, children: 2, couples: 4 }, "Mpho"));
    expect(mixed.units.reduce((s, u) => s + u.adults + u.children, 0)).toBe(16);
    expect(quoteStaleReasons({ ...base, request: mixed })).toEqual([expect.stringMatching(/guest parties changed/)]);
    expect(() => transition({ ...base, request: mixed }, { type: "owner_approve", ownerName: "Owner" }, C("owner"))).toThrow(STALE);
    // An access need moved to another party is material too.
    const moved = req(R16.units.map((u, i) => ({ ...u, access: i === R16.units.length - 1 ? "ground-floor" as const : "none" as const })));
    expect(R16.units.every((u) => u.access === "none")).toBe(true);
    expect(quoteStaleReasons({ ...base, request: moved })).toEqual([expect.stringMatching(/guest parties changed/)]);
    const renamed = req(R16.units.map((u) => ({ ...u, label: u.label + " (renamed)" })));
    expect(quoteStaleReasons({ ...base, request: renamed })).toEqual([]);
  });

  it("6 · dates changed, or room lines that no longer hold the quoted guests → blocked", () => {
    const base = at(R16, "approved");
    const later = { ...base, request: { ...R16, checkIn: "2026-11-28", checkOut: "2026-12-01" } };
    expect(quoteStaleReasons(later)).toEqual([expect.stringMatching(/dates changed/)]);
    expect(() => transition(later, { type: "send_quote" }, C("staff"))).toThrow(STALE);
    const dropped = { ...base, quote: { ...base.quote!, lines: base.quote!.lines.slice(1) } };
    expect(quoteStaleReasons(dropped).join()).toMatch(/quote rooms hold \d+ guests but the quote is for 16/);
  });

  it("7 · an unchanged, valid quote goes all the way to confirmed as before", () => {
    let e = at(R16, "awaiting_payment_paid");
    expect(quoteStaleReasons(e)).toEqual([]);
    e = transition(e, { type: "confirm" }, C("owner"));
    expect(e.status).toBe("confirmed");
    expect(bookingsForConfirmed(e).reduce((s, b) => s + b.guests, 0)).toBe(16);
  });

  it("8 · calling the workflow directly (bypassing the UI and canTransition) is still refused, for every committing action and actor", () => {
    // There is no server-side workflow API: every caller (browser store, demo seeding) goes through transition().
    const pend = { ...at(R8, "pending_approval"), request: R16 };
    const appr = { ...at(R8, "approved"), request: R16 };
    const paid = { ...at(R8, "awaiting_payment_paid"), request: R16 };
    expect(() => transition(pend, { type: "owner_approve", ownerName: "Owner" }, C("owner"))).toThrow(STALE);
    for (const actor of ["staff", "owner"] as const) expect(() => transition(appr, { type: "send_quote" }, C(actor))).toThrow(STALE);
    for (const actor of ["owner", "system"] as const) expect(() => transition(paid, { type: "confirm" }, C(actor))).toThrow(STALE);
    // Stale client snapshot: an action checked against an OLD copy of the enquiry passes, the latest copy fails.
    // (The browser store therefore re-runs the transition on the latest state before saving it.)
    const snapshot = at(R8, "pending_approval");
    expect(() => transition(snapshot, { type: "owner_approve", ownerName: "Owner" }, C("owner"))).not.toThrow();
    expect(() => transition({ ...snapshot, request: R16 }, { type: "owner_approve", ownerName: "Owner" }, C("owner"))).toThrow(STALE);
  });

  it("9 · a manual discount override is kept (with its audit event) and validated against the current parties", () => {
    let e = at(R16, "pending_approval");
    e = transition(e, { type: "revise_draft", quote: reviseQuote(e.quote!, { discountPercent: 10, notes: "Owner: choir rate" }, DEMO_PROPERTY.depositPercent) }, C("owner"));
    expect(e.events.at(-1)).toMatchObject({ action: "revise_draft", note: "Quote v2" });
    e = transition(e, { type: "submit_for_approval" }, C("staff"));
    const priced = { total: e.quote!.total, discountPercent: e.quote!.discountPercent };
    expect(priced.discountPercent).toBe(10);
    // Parties change → the overridden quote is blocked, and NOT silently repriced.
    const changed = { ...e, request: R8 };
    expect(() => transition(changed, { type: "owner_approve", ownerName: "Owner" }, C("owner"))).toThrow(STALE);
    expect({ total: changed.quote!.total, discountPercent: changed.quote!.discountPercent }).toEqual(priced);
    // Unchanged parties → the override is approved as is.
    e = transition(e, { type: "owner_approve", ownerName: "Owner" }, C("owner"));
    expect(e.quote!.discountPercent).toBe(10);
    expect(e.approval?.quoteVersion).toBe(2);
  });

  it("10 · seeded demo data (including confirmed bookings) is untouched: every seeded quote is current", () => {
    const seeded = createDemoEnquiries("2026-11-01", createDemoBookings("2026-11-01"));
    expect(seeded.enquiries.length).toBeGreaterThan(0);
    for (const e of seeded.enquiries) expect(quoteStaleReasons(e)).toEqual([]);
    const confirmed = seeded.enquiries.filter((e) => e.status === "confirmed");
    expect(confirmed.length).toBeGreaterThan(0);
    for (const e of confirmed) expect(bookingsForConfirmed(e).length).toBe(e.quote!.lines.length);
  });
});
