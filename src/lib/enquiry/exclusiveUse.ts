import type { Booking, ISODate, Room } from "../domain/types";
import type { OpenQuestion } from "./openQuestions";

/**
 * EXCLUSIVE USE (whole-house bookings) — a binding requirement, never a note.
 *
 * Two virtual packages over the physical units (never extra rooms, never double-counted):
 * - "main-house":     every guest room, NOT the self-catering apartment;
 * - "whole-property": every unit, including the apartment.
 * A package is available only when EVERY included unit is free for the stay (checkout day is not occupied).
 * Package pricing is not configured in this prototype, so the app never quotes an exclusive booking itself:
 * it reports availability and leaves pricing and approval to the owner. It never offers ordinary rooms in its place.
 */
export type ExclusivePackage = "main-house" | "whole-property";
export type ExclusiveRequest = ExclusivePackage | "unspecified";

export const PACKAGE_LABEL: Record<ExclusivePackage, string> = {
  "main-house": "Main House (all guest rooms, excluding the self-catering apartment)",
  "whole-property": "Whole Property (all guest rooms and the self-catering apartment)",
};

const EXCLUSIVE = /\b(exclusive(?:ly)?(?:\s+use)?|(?:whole|entire|full)\s+(?:guest\s?house|gastehuis|house|property|place|venue|lodge|b&b)|book\s+(?:out\s+)?(?:all|every)\s+(?:of\s+)?(?:the\s+)?rooms|hele\s+(?:gastehuis|plek|huis))\b/i;
const MAIN_HOUSE = /\b(main\s+house|(?:without|excluding|except|not)\s+the\s+(?:apartment|flat|self[- ]catering)|rooms\s+only|only\s+the\s+rooms)\b/i;
const WHOLE_PROPERTY = /\b(whole\s+property|entire\s+property|(?:incl\w*|and|plus|with)\s+the\s+(?:apartment|flat|self[- ]catering\s+(?:apartment|unit))|everything|all\s+units|woonstel)\b/i;

/** Deterministic detection from the guest's words (or the AI's notes about them). */
export function detectExclusiveUse(text: string, notes: string[] = []): ExclusiveRequest | undefined {
  const all = [text, ...notes].join("\n");
  if (!EXCLUSIVE.test(all)) return undefined;
  if (MAIN_HOUSE.test(text)) return "main-house";
  if (WHOLE_PROPERTY.test(text)) return "whole-property";
  return "unspecified";
}

export const EXCLUSIVE_QUESTION_PREFIX = "Exclusive use requested:";

export function exclusiveQuestion(): OpenQuestion {
  return {
    topic: "requirement",
    text: `${EXCLUSIVE_QUESTION_PREFIX} does the guest want the Main House (guest rooms only, excluding the apartment) or the Whole Property (guest rooms and the apartment)? Ordinary rooms are not offered until this is answered`,
    blocksAllocation: true,
  };
}

/** Reads the guest's recorded answer to the package question. "none" = the guest agreed to ordinary (non-exclusive) rooms. */
export function packageFromAnswer(answer: string): ExclusivePackage | "none" | undefined {
  if (/\b(not\s+exclusive|no\s+need\s+for\s+exclusive|separate\s+rooms|ordinary\s+rooms|just\s+(?:the\s+)?rooms\s+we\s+need)\b/i.test(answer)) return "none";
  if (MAIN_HOUSE.test(answer)) return "main-house";
  if (WHOLE_PROPERTY.test(answer)) return "whole-property";
  return undefined;
}

/** The physical units a package reserves. */
export function packageRooms(rooms: Room[], pkg: ExclusivePackage): Room[] {
  return pkg === "whole-property" ? rooms : rooms.filter((r) => !r.selfCatering);
}

function overlaps(aIn: ISODate, aOut: ISODate, bIn: ISODate, bOut: ISODate): boolean {
  return aIn < bOut && bIn < aOut; // checkout day is not an occupied night
}

export interface PackageAvailability {
  package: ExclusivePackage;
  available: boolean;
  capacity: number;
  units: number;
  /** Included units already booked or blocked for any night of the stay. */
  blocked: Room[];
}

export function packageAvailability(rooms: Room[], bookings: Booking[], pkg: ExclusivePackage, checkIn: ISODate, checkOut: ISODate): PackageAvailability {
  const included = packageRooms(rooms, pkg);
  const blocked = included.filter((r) => bookings.some((b) => b.roomId === r.id && overlaps(b.checkIn, b.checkOut, checkIn, checkOut)));
  return { package: pkg, available: blocked.length === 0, capacity: included.reduce((s, r) => s + r.capacity, 0), units: included.length, blocked };
}
