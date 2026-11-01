/**
 * Core domain types for Hospitality AI.
 *
 * Everything that affects money, capacity, availability or booking status is
 * modelled here and handled by deterministic code. AI providers may only
 * *suggest* values (e.g. an interpreted enquiry), which are then validated.
 */

/** ISO calendar date, e.g. "2026-12-12". */
export type ISODate = string;

export type BedType = "queen" | "double" | "single" | "bunk";

export interface Bed {
  type: BedType;
  count: number;
}

export interface RoomRate {
  /** Nightly rate for the room covering up to `includedGuests` guests (ZAR, fictional). */
  base: number;
  includedGuests: number;
  /** Nightly charge per guest above `includedGuests`. */
  extraGuest: number;
  /** Optional reduced nightly rate when only one guest occupies the room. */
  singleOccupancy?: number;
}

export interface Room {
  id: string;
  name: string;
  shortName: string;
  capacity: number;
  beds: Bed[];
  floor: "ground" | "first";
  /** Step-free, wheelchair-accessible room and bathroom. */
  wheelchairAccessible: boolean;
  privateEntrance: boolean;
  selfCatering: boolean;
  description: string;
  rate: RoomRate;
}

export interface Property {
  name: string;
  location: string;
  currency: "ZAR";
  currencySymbol: string;
  rooms: Room[];
  /** Percentage of the quote total payable as deposit to confirm. */
  depositPercent: number;
  checkInTime: string;
  checkOutTime: string;
}

export interface Booking {
  id: string;
  roomId: string;
  guestName: string;
  checkIn: ISODate;
  checkOut: ISODate;
  guests: number;
  /** "blocked" covers maintenance / owner use. */
  kind: "booking" | "blocked";
  /** Reference to the quote that produced this booking, if any. */
  quoteId?: string;
}

export type UnitKind = "couple" | "family" | "individual" | "friends" | "driver" | "group-leader";

export type AccessNeed = "none" | "ground-floor" | "wheelchair";

/**
 * A group of guests who sleep together (or alone) — the smallest thing the
 * allocation engine places into a room. A unit is never split unless the
 * engine has to fall back to an alternative arrangement, which it flags.
 */
export interface GuestUnit {
  id: string;
  label: string;
  kind: UnitKind;
  adults: number;
  children: number;
  /** Number of couples within the unit who need a shared (queen/double) bed. */
  couples: number;
  /** Every guest in this unit needs their own bed (no bed sharing at all). */
  separateBeds: boolean;
  /** This unit must not share a room with any other unit (drivers, group leaders). */
  privateRoom: boolean;
  access: AccessNeed;
}

export interface StayRequest {
  checkIn: ISODate;
  checkOut: ISODate;
  units: GuestUnit[];
}

export interface RoomAssignment {
  roomId: string;
  unitIds: string[];
  guests: number;
  /** Human-readable bed plan, e.g. "Queen: Thandi & Sipho (couple)". */
  sleeping: string[];
  nightlyRate: number;
}

export interface AllocationOption {
  id: string;
  key: "efficient" | "privacy" | "alternative";
  title: string;
  summary: string;
  assignments: RoomAssignment[];
  roomsUsed: number;
  totalGuests: number;
  nights: number;
  totalPrice: number;
  /** Unused sleeping spaces across the allocated rooms. */
  spareBeds: number;
  /** Count of units that share a room with another unit. */
  sharedRoomUnits: number;
  /** Compromises the guests must accept (e.g. family split across rooms). */
  compromises: string[];
  highlights: string[];
}

export interface AllocationResult {
  ok: boolean;
  options: AllocationOption[];
  /** Validation or feasibility problems. */
  errors: string[];
  warnings: string[];
  /** Explanation of how options differ, generated deterministically. */
  comparison: string;
  /** Nearby check-in dates where a full allocation is possible (when none now). */
  alternativeDates: ISODate[];
  availableRoomIds: string[];
}

export interface QuoteLine {
  roomId: string;
  description: string;
  guests: number;
  nights: number;
  nightlyRate: number;
  total: number;
}

export interface Quote {
  id: string;
  /** Incremented on every edit; approvals are tied to a specific version. */
  version: number;
  enquiryId: string;
  guestName: string;
  checkIn: ISODate;
  checkOut: ISODate;
  nights: number;
  optionTitle: string;
  lines: QuoteLine[];
  subtotal: number;
  discountPercent: number;
  discount: number;
  total: number;
  deposit: number;
  notes: string;
  units: GuestUnit[];
  createdAt: string;
}

export type WorkflowStatus =
  | "enquiry"
  | "draft_quote"
  | "pending_approval"
  | "approved"
  | "quote_sent"
  | "guest_accepted"
  | "awaiting_payment"
  | "confirmed"
  | "declined"
  | "cancelled";

export type Actor = "owner" | "staff" | "guest" | "system";

export interface WorkflowEvent {
  at: string;
  actor: Actor;
  action: string;
  from: WorkflowStatus;
  to: WorkflowStatus;
  note?: string;
}

export interface Approval {
  approvedBy: string;
  approvedAt: string;
  quoteVersion: number;
}

export interface PaymentRecord {
  /** Mission 1 never collects real payments. */
  simulated: true;
  reference: string;
  amount: number;
  receivedAt: string;
}

export interface EnquiryChannelMessage {
  from: "guest" | "house";
  text: string;
  at: string;
}

export interface Enquiry {
  id: string;
  guestName: string;
  phone: string;
  channel: "whatsapp" | "email" | "phone";
  receivedAt: string;
  messages: EnquiryChannelMessage[];
  status: WorkflowStatus;
  request?: StayRequest;
  quote?: Quote;
  approval?: Approval;
  payment?: PaymentRecord;
  events: WorkflowEvent[];
  /** How the enquiry was interpreted, for transparency in the UI. */
  interpretedBy?: "simulation" | "meta" | "dev-model" | "test" | "manual";
}
