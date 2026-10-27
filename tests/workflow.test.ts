import { describe, expect, it } from "vitest";
import { allocate } from "@/lib/allocation/engine";
import { DEMO_PROPERTY, DEMO_ROOMS } from "@/lib/data/property";
import { buildQuote, reviseQuote } from "@/lib/quote/pricing";
import { bookingsForConfirmed, canTransition, transition, type TransitionContext } from "@/lib/workflow/stateMachine";
import type { Booking, Enquiry } from "@/lib/domain/types";
import { couple } from "./helpers";

const request = { checkIn: "2026-12-10", checkOut: "2026-12-12", units: [couple("Thandi & Sipho")] };
const option = allocate(request, { rooms: DEMO_ROOMS, bookings: [] }).options[0];
const quote = buildQuote({ id: "Q-1", enquiryId: "E-1", guestName: "Thandi", request, option, property: DEMO_PROPERTY, now: "2026-10-01T00:00:00Z" });

const enquiry = (): Enquiry => ({
  id: "E-1",
  guestName: "Thandi",
  phone: "+27 00 000 0000",
  channel: "whatsapp",
  receivedAt: "2026-10-01T00:00:00Z",
  messages: [],
  status: "enquiry",
  request,
  events: [],
});

const ctx = (actor: TransitionContext["actor"], bookings: Booking[] = []): TransitionContext => ({
  actor,
  rooms: DEMO_ROOMS,
  bookings,
  depositPercent: DEMO_PROPERTY.depositPercent,
  now: "2026-10-02T00:00:00Z",
});

const payment = (amount = quote.deposit) => ({ simulated: true as const, reference: "SIM-001", amount, receivedAt: "2026-10-03T00:00:00Z" });

function toPendingApproval(): Enquiry {
  let e = transition(enquiry(), { type: "create_draft", quote }, ctx("staff"));
  e = transition(e, { type: "submit_for_approval" }, ctx("staff"));
  return e;
}

function toAwaitingPayment(): Enquiry {
  let e = toPendingApproval();
  e = transition(e, { type: "owner_approve", ownerName: "Owner" }, ctx("owner"));
  e = transition(e, { type: "send_quote" }, ctx("staff"));
  e = transition(e, { type: "guest_accept" }, ctx("guest"));
  e = transition(e, { type: "request_payment" }, ctx("staff"));
  return e;
}

describe("booking workflow", () => {
  it("follows Enquiry → Draft → Approval → Sent → Accepted → Awaiting payment → Confirmed", () => {
    let e = toAwaitingPayment();
    e = transition(e, { type: "record_payment", payment: payment() }, ctx("owner"));
    e = transition(e, { type: "confirm" }, ctx("owner"));
    expect(e.status).toBe("confirmed");
    expect(e.events.map((x) => x.to)).toEqual([
      "draft_quote",
      "pending_approval",
      "approved",
      "quote_sent",
      "guest_accepted",
      "awaiting_payment",
      "awaiting_payment",
      "confirmed",
    ]);
    const bookings = bookingsForConfirmed(e);
    expect(bookings).toHaveLength(1);
    expect(bookings[0].quoteId).toBe("Q-1");
  });

  it("only the owner can approve", () => {
    const e = toPendingApproval();
    expect(() => transition(e, { type: "owner_approve", ownerName: "Staff" }, ctx("staff"))).toThrow(/Only owner/);
    expect(canTransition(e, "owner_approve", "staff")).toBe(false);
    expect(canTransition(e, "owner_approve", "owner")).toBe(true);
  });

  it("a quote cannot be sent without owner approval", () => {
    const e = toPendingApproval();
    expect(() => transition(e, { type: "send_quote" }, ctx("staff"))).toThrow(/Cannot send quote/);
    const draft = transition(enquiry(), { type: "create_draft", quote }, ctx("staff"));
    expect(() => transition(draft, { type: "send_quote" }, ctx("owner"))).toThrow();
  });

  it("cannot confirm without a recorded payment", () => {
    const e = toAwaitingPayment();
    expect(() => transition(e, { type: "confirm" }, ctx("owner"))).toThrow(/no payment/);
  });

  it("cannot confirm with an underpaid deposit", () => {
    const e = toAwaitingPayment();
    expect(() => transition(e, { type: "record_payment", payment: payment(quote.deposit - 1) }, ctx("owner"))).toThrow(/below the required deposit/);
  });

  it("rejects non-simulated payments in the demo", () => {
    const e = toAwaitingPayment();
    const real = { ...payment(), simulated: false } as unknown as ReturnType<typeof payment>;
    expect(() => transition(e, { type: "record_payment", payment: real }, ctx("owner"))).toThrow(/simulated/);
  });

  it("editing an approved quote voids the approval", () => {
    let e = toPendingApproval();
    e = transition(e, { type: "owner_approve", ownerName: "Owner" }, ctx("owner"));
    const revised = reviseQuote(e.quote!, { discountPercent: 10 }, 50);
    e = transition(e, { type: "revise_draft", quote: revised }, ctx("staff"));
    expect(e.status).toBe("draft_quote");
    expect(e.approval).toBeUndefined();
    e = transition(e, { type: "submit_for_approval" }, ctx("staff"));
    expect(() => transition(e, { type: "send_quote" }, ctx("staff"))).toThrow();
  });

  it("detects an approval that does not match the current quote version", () => {
    const e = toAwaitingPayment();
    const tampered: Enquiry = { ...e, quote: { ...e.quote!, version: 99 } };
    expect(() => transition(tampered, { type: "record_payment", payment: payment() }, ctx("owner"))).toThrow(/re-approve/);
  });

  it("owner rejection needs a reason and returns to draft", () => {
    const e = toPendingApproval();
    expect(() => transition(e, { type: "owner_reject", reason: " " }, ctx("owner"))).toThrow(/reason/);
    const r = transition(e, { type: "owner_reject", reason: "Offer Room 8 instead" }, ctx("owner"));
    expect(r.status).toBe("draft_quote");
    expect(r.events.at(-1)?.note).toBe("Offer Room 8 instead");
  });

  it("refuses approval and confirmation if the room was booked meanwhile", () => {
    const clash: Booking[] = [
      { id: "other", roomId: quote.lines[0].roomId, guestName: "Someone", checkIn: "2026-12-11", checkOut: "2026-12-13", guests: 2, kind: "booking" },
    ];
    expect(() => transition(toPendingApproval(), { type: "owner_approve", ownerName: "Owner" }, ctx("owner", clash))).toThrow(/no longer available/);
    let e = toAwaitingPayment();
    e = transition(e, { type: "record_payment", payment: payment() }, ctx("owner"));
    expect(() => transition(e, { type: "confirm" }, ctx("owner", clash))).toThrow(/no longer available/);
  });

  it("rejects quotes with inconsistent totals", () => {
    const bad = { ...quote, total: quote.total + 500 };
    expect(() => transition(enquiry(), { type: "create_draft", quote: bad }, ctx("staff"))).toThrow(/validation/);
  });

  it("cannot skip steps", () => {
    expect(() => transition(enquiry(), { type: "confirm" }, ctx("owner"))).toThrow();
    expect(() => transition(enquiry(), { type: "guest_accept" }, ctx("guest"))).toThrow();
  });
});
