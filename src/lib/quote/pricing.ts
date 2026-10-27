import type { AllocationOption, GuestUnit, Property, Quote, QuoteLine, Room, StayRequest } from "../domain/types";
import { nightsBetween } from "../domain/dates";

/**
 * Room-based pricing: each room has a nightly rate covering a number of
 * guests, plus a per-guest supplement above that. There is deliberately no
 * flat per-person price.
 */
export function nightlyRoomRate(room: Room, guests: number): number {
  if (!Number.isInteger(guests) || guests < 1) throw new Error(`Invalid guest count ${guests} for ${room.shortName}`);
  if (guests > room.capacity) throw new Error(`${room.shortName} sleeps ${room.capacity}, cannot price ${guests} guests`);
  const { base, includedGuests, extraGuest, singleOccupancy } = room.rate;
  if (guests === 1 && singleOccupancy !== undefined) return singleOccupancy;
  return base + Math.max(0, guests - includedGuests) * extraGuest;
}

export interface QuoteTotals {
  subtotal: number;
  discount: number;
  total: number;
  deposit: number;
}

export function computeTotals(lines: QuoteLine[], discountPercent: number, depositPercent: number): QuoteTotals {
  if (!(discountPercent >= 0 && discountPercent <= 30)) throw new Error("Discount must be between 0% and 30%");
  const subtotal = lines.reduce((sum, l) => sum + l.total, 0);
  const discount = Math.round((subtotal * discountPercent) / 100);
  const total = subtotal - discount;
  const deposit = Math.round((total * depositPercent) / 100);
  return { subtotal, discount, total, deposit };
}

export function buildQuoteLines(option: AllocationOption, rooms: Room[], nights: number): QuoteLine[] {
  return option.assignments.map((a) => {
    const room = rooms.find((r) => r.id === a.roomId);
    if (!room) throw new Error(`Unknown room ${a.roomId}`);
    // Re-price from the room table rather than trusting the option's figure.
    const nightlyRate = nightlyRoomRate(room, a.guests);
    return {
      roomId: room.id,
      description: room.name,
      guests: a.guests,
      nights,
      nightlyRate,
      total: nightlyRate * nights,
    };
  });
}

export interface BuildQuoteInput {
  id: string;
  enquiryId: string;
  guestName: string;
  request: StayRequest;
  option: AllocationOption;
  property: Property;
  discountPercent?: number;
  notes?: string;
  now?: string;
}

export function buildQuote(input: BuildQuoteInput): Quote {
  const { request, option, property } = input;
  const nights = nightsBetween(request.checkIn, request.checkOut);
  const lines = buildQuoteLines(option, property.rooms, nights);
  const discountPercent = input.discountPercent ?? 0;
  const totals = computeTotals(lines, discountPercent, property.depositPercent);
  return {
    id: input.id,
    version: 1,
    enquiryId: input.enquiryId,
    guestName: input.guestName,
    checkIn: request.checkIn,
    checkOut: request.checkOut,
    nights,
    optionTitle: option.title,
    lines,
    discountPercent,
    ...totals,
    notes: input.notes ?? "",
    units: request.units.map((u: GuestUnit) => ({ ...u })),
    createdAt: input.now ?? new Date().toISOString(),
  };
}

/** Returns a new quote version with an updated discount / notes. Totals are always recomputed. */
export function reviseQuote(
  quote: Quote,
  changes: { discountPercent?: number; notes?: string },
  depositPercent: number,
): Quote {
  const discountPercent = changes.discountPercent ?? quote.discountPercent;
  const totals = computeTotals(quote.lines, discountPercent, depositPercent);
  return {
    ...quote,
    version: quote.version + 1,
    discountPercent,
    notes: changes.notes ?? quote.notes,
    ...totals,
  };
}

/** Independent check that a quote's arithmetic is internally consistent. */
export function verifyQuoteTotals(quote: Quote, rooms: Room[], depositPercent: number): string[] {
  const problems: string[] = [];
  for (const line of quote.lines) {
    const room = rooms.find((r) => r.id === line.roomId);
    if (!room) {
      problems.push(`Unknown room ${line.roomId}`);
      continue;
    }
    if (line.guests > room.capacity) problems.push(`${room.shortName} over capacity`);
    else if (line.nightlyRate !== nightlyRoomRate(room, line.guests)) problems.push(`${room.shortName} rate mismatch`);
    if (line.total !== line.nightlyRate * line.nights) problems.push(`${room.shortName} line total mismatch`);
    if (line.nights !== quote.nights) problems.push(`${room.shortName} nights mismatch`);
  }
  const totals = computeTotals(quote.lines, quote.discountPercent, depositPercent);
  if (totals.subtotal !== quote.subtotal) problems.push("Subtotal mismatch");
  if (totals.discount !== quote.discount) problems.push("Discount mismatch");
  if (totals.total !== quote.total) problems.push("Total mismatch");
  if (totals.deposit !== quote.deposit) problems.push("Deposit mismatch");
  return problems;
}
