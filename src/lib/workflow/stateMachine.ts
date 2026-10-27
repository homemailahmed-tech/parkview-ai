import type { Actor, Booking, Enquiry, PaymentRecord, Quote, Room, WorkflowStatus } from "../domain/types";
import { isRoomAvailable } from "../allocation/engine";
import { verifyQuoteTotals } from "../quote/pricing";

/**
 * Enquiry → Draft Quote → Owner Approval → Quote Sent → Guest Acceptance →
 * Awaiting Payment → Confirmed.
 *
 * Every transition is checked here. A booking can only become confirmed when
 * the owner has approved the *current* quote version and a (simulated)
 * payment has been recorded.
 */
export type WorkflowAction =
  | { type: "create_draft"; quote: Quote }
  | { type: "revise_draft"; quote: Quote }
  | { type: "submit_for_approval" }
  | { type: "owner_approve"; ownerName: string }
  | { type: "owner_reject"; reason: string }
  | { type: "send_quote" }
  | { type: "guest_accept" }
  | { type: "guest_decline"; reason?: string }
  | { type: "request_payment" }
  | { type: "record_payment"; payment: PaymentRecord }
  | { type: "confirm" }
  | { type: "cancel"; reason: string };

export const STATUS_LABEL: Record<WorkflowStatus, string> = {
  enquiry: "Enquiry",
  draft_quote: "Draft quote",
  pending_approval: "Awaiting owner approval",
  approved: "Owner approved",
  quote_sent: "Quote sent",
  guest_accepted: "Guest accepted",
  awaiting_payment: "Awaiting payment",
  confirmed: "Confirmed",
  declined: "Declined by guest",
  cancelled: "Cancelled",
};

export const PIPELINE: WorkflowStatus[] = [
  "enquiry",
  "draft_quote",
  "pending_approval",
  "approved",
  "quote_sent",
  "guest_accepted",
  "awaiting_payment",
  "confirmed",
];

const ALLOWED: Record<WorkflowAction["type"], { from: WorkflowStatus[]; to: WorkflowStatus; actors: Actor[] }> = {
  create_draft: { from: ["enquiry", "draft_quote"], to: "draft_quote", actors: ["staff", "owner", "system"] },
  revise_draft: { from: ["draft_quote", "pending_approval", "approved"], to: "draft_quote", actors: ["staff", "owner"] },
  submit_for_approval: { from: ["draft_quote"], to: "pending_approval", actors: ["staff", "owner", "system"] },
  owner_approve: { from: ["pending_approval"], to: "approved", actors: ["owner"] },
  owner_reject: { from: ["pending_approval"], to: "draft_quote", actors: ["owner"] },
  send_quote: { from: ["approved"], to: "quote_sent", actors: ["staff", "owner"] },
  guest_accept: { from: ["quote_sent"], to: "guest_accepted", actors: ["guest", "staff", "owner"] },
  guest_decline: { from: ["quote_sent", "guest_accepted", "awaiting_payment"], to: "declined", actors: ["guest", "staff", "owner"] },
  request_payment: { from: ["guest_accepted"], to: "awaiting_payment", actors: ["staff", "owner", "system"] },
  record_payment: { from: ["awaiting_payment"], to: "awaiting_payment", actors: ["owner"] },
  confirm: { from: ["awaiting_payment"], to: "confirmed", actors: ["owner", "system"] },
  cancel: {
    from: ["enquiry", "draft_quote", "pending_approval", "approved", "quote_sent", "guest_accepted", "awaiting_payment"],
    to: "cancelled",
    actors: ["owner", "staff"],
  },
};

export class WorkflowError extends Error {}

export interface TransitionContext {
  actor: Actor;
  rooms: Room[];
  /** All current bookings — used to re-check availability before approval and confirmation. */
  bookings: Booking[];
  depositPercent: number;
  now?: string;
}

export function canTransition(enquiry: Enquiry, type: WorkflowAction["type"], actor: Actor): boolean {
  const rule = ALLOWED[type];
  return rule.from.includes(enquiry.status) && rule.actors.includes(actor);
}

function assertQuoteValid(quote: Quote | undefined, ctx: TransitionContext): Quote {
  if (!quote) throw new WorkflowError("No quote attached to this enquiry");
  const problems = verifyQuoteTotals(quote, ctx.rooms, ctx.depositPercent);
  if (problems.length) throw new WorkflowError(`Quote failed validation: ${problems.join("; ")}`);
  return quote;
}

function assertRoomsFree(quote: Quote, ctx: TransitionContext, ignoreQuoteId?: string) {
  const others = ctx.bookings.filter((b) => b.quoteId !== ignoreQuoteId);
  const clashes = quote.lines.filter((l) => !isRoomAvailable(l.roomId, others, quote.checkIn, quote.checkOut));
  if (clashes.length) {
    throw new WorkflowError(`Room(s) no longer available: ${clashes.map((l) => l.description).join(", ")}`);
  }
}

export function transition(enquiry: Enquiry, action: WorkflowAction, ctx: TransitionContext): Enquiry {
  const rule = ALLOWED[action.type];
  if (!rule.from.includes(enquiry.status)) {
    throw new WorkflowError(`Cannot ${action.type.replace(/_/g, " ")} while status is "${STATUS_LABEL[enquiry.status]}"`);
  }
  if (!rule.actors.includes(ctx.actor)) {
    throw new WorkflowError(`Only ${rule.actors.join("/")} may ${action.type.replace(/_/g, " ")}`);
  }

  const now = ctx.now ?? new Date().toISOString();
  let next: Enquiry = { ...enquiry };
  let note: string | undefined;

  switch (action.type) {
    case "create_draft":
    case "revise_draft": {
      assertQuoteValid(action.quote, ctx);
      // Any change to the quote voids an earlier approval.
      next = { ...next, quote: action.quote, approval: undefined };
      note = `Quote v${action.quote.version}`;
      break;
    }
    case "submit_for_approval": {
      assertQuoteValid(next.quote, ctx);
      break;
    }
    case "owner_approve": {
      const quote = assertQuoteValid(next.quote, ctx);
      if (!action.ownerName.trim()) throw new WorkflowError("Owner name is required to approve");
      assertRoomsFree(quote, ctx, quote.id);
      next.approval = { approvedBy: action.ownerName.trim(), approvedAt: now, quoteVersion: quote.version };
      note = `Approved v${quote.version} by ${action.ownerName.trim()}`;
      break;
    }
    case "owner_reject": {
      if (!action.reason.trim()) throw new WorkflowError("A reason is required when rejecting a quote");
      next.approval = undefined;
      note = action.reason;
      break;
    }
    case "send_quote": {
      requireApproval(next);
      break;
    }
    case "guest_accept":
    case "request_payment": {
      requireApproval(next);
      break;
    }
    case "guest_decline":
    case "cancel": {
      note = "reason" in action ? action.reason : undefined;
      break;
    }
    case "record_payment": {
      const quote = requireApproval(next);
      if (action.payment.simulated !== true) throw new WorkflowError("Only simulated payments are supported in this demo");
      if (action.payment.amount < quote.deposit) {
        throw new WorkflowError(`Payment of ${action.payment.amount} is below the required deposit of ${quote.deposit}`);
      }
      next.payment = action.payment;
      note = `Simulated payment ${action.payment.reference}`;
      break;
    }
    case "confirm": {
      const quote = requireApproval(next);
      if (!next.payment) throw new WorkflowError("Cannot confirm: no payment has been recorded");
      if (next.payment.amount < quote.deposit) throw new WorkflowError("Cannot confirm: deposit not fully paid");
      assertRoomsFree(quote, ctx, quote.id);
      break;
    }
  }

  next.status = rule.to;
  next.events = [
    ...enquiry.events,
    { at: now, actor: ctx.actor, action: action.type, from: enquiry.status, to: rule.to, ...(note ? { note } : {}) },
  ];
  return next;
}

function requireApproval(e: Enquiry): Quote {
  if (!e.quote) throw new WorkflowError("No quote attached to this enquiry");
  if (!e.approval) throw new WorkflowError("Owner approval is required");
  if (e.approval.quoteVersion !== e.quote.version) throw new WorkflowError("Quote changed after approval — owner must re-approve");
  return e.quote;
}

/** Bookings created when an enquiry is confirmed. */
export function bookingsForConfirmed(e: Enquiry): Booking[] {
  if (e.status !== "confirmed" || !e.quote) return [];
  return e.quote.lines.map((l, i) => ({
    id: `${e.quote!.id}-${i + 1}`,
    roomId: l.roomId,
    guestName: e.guestName,
    checkIn: e.quote!.checkIn,
    checkOut: e.quote!.checkOut,
    guests: l.guests,
    kind: "booking" as const,
    quoteId: e.quote!.id,
  }));
}
