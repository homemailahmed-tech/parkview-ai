import type {
  AllocationOption,
  AllocationResult,
  Booking,
  GuestUnit,
  ISODate,
  Room,
  RoomAssignment,
  StayRequest,
} from "../domain/types";
import { addDays, isValidISODate, nightsBetween, rangesOverlap, toUTC } from "../domain/dates";
import { nightlyRoomRate } from "../quote/pricing";
import { planBeds, unitSize, type BedPlan } from "./beds";
import { PACKAGE_LABEL, packageAvailability } from "../enquiry/exclusiveUse";

export const MAX_NIGHTS = 30;
export const MAX_UNIT_GUESTS = 30;

export interface AllocateOptions {
  rooms: Room[];
  bookings: Booking[];
  /** Reject check-in dates before this day (optional). */
  today?: ISODate;
  /** Search budget per strategy — keeps the engine fast and deterministic. */
  nodeLimit?: number;
  /** Look for nearby dates when nothing fits (default true). */
  suggestDates?: boolean;
}

type Mode = "efficient" | "privacy";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function validateUnit(u: GuestUnit): string[] {
  const errors: string[] = [];
  const name = u.label || u.id;
  const isCount = (n: number) => Number.isInteger(n) && n >= 0;
  if (!isCount(u.adults) || !isCount(u.children) || !isCount(u.couples)) {
    errors.push(`${name}: guest counts must be whole numbers of zero or more`);
    return errors;
  }
  if (unitSize(u) === 0) errors.push(`${name}: has no guests`);
  if (unitSize(u) > MAX_UNIT_GUESTS) errors.push(`${name}: too many guests in one party`);
  if (u.children > 0 && u.adults === 0) errors.push(`${name}: children must be accompanied by an adult`);
  if (u.couples * 2 > u.adults) errors.push(`${name}: ${u.couples} couple(s) needs at least ${u.couples * 2} adults`);
  if (u.separateBeds && u.couples > 0) errors.push(`${name}: cannot both need separate beds and contain couples sharing a bed`);
  return errors;
}

export function validateStayRequest(req: StayRequest, today?: ISODate): string[] {
  const errors: string[] = [];
  if (!isValidISODate(req.checkIn)) errors.push("Check-in date is missing or invalid");
  if (!isValidISODate(req.checkOut)) errors.push("Check-out date is missing or invalid");
  if (errors.length === 0) {
    const nights = nightsBetween(req.checkIn, req.checkOut);
    if (nights < 1) errors.push("Check-out must be after check-in");
    if (nights > MAX_NIGHTS) errors.push(`Stays longer than ${MAX_NIGHTS} nights need a manual quote`);
    if (today && isValidISODate(today) && toUTC(req.checkIn) < toUTC(today)) errors.push("Check-in date is in the past");
  }
  if (!req.units || req.units.length === 0) errors.push("At least one guest is required");
  const ids = new Set<string>();
  for (const u of req.units ?? []) {
    if (ids.has(u.id)) errors.push(`Duplicate party id ${u.id}`);
    ids.add(u.id);
    errors.push(...validateUnit(u));
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

export function isRoomAvailable(roomId: string, bookings: Booking[], checkIn: ISODate, checkOut: ISODate): boolean {
  return !bookings.some((b) => b.roomId === roomId && rangesOverlap(b.checkIn, b.checkOut, checkIn, checkOut));
}

export function availableRooms(rooms: Room[], bookings: Booking[], checkIn: ISODate, checkOut: ISODate): Room[] {
  return rooms.filter((r) => isRoomAvailable(r.id, bookings, checkIn, checkOut));
}

export function roomSuitsUnit(room: Room, u: GuestUnit): boolean {
  if (u.access === "wheelchair" && !room.wheelchairAccessible) return false;
  if (u.access === "ground-floor" && room.floor !== "ground") return false;
  return true;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

interface Evaluated {
  assignments: Map<string, GuestUnit[]>;
  plans: Map<string, BedPlan>;
  nightly: number;
  roomsUsed: number;
  sharedRoomUnits: number;
  comfort: number;
}

function sharedCount(map: Map<string, GuestUnit[]>): number {
  let n = 0;
  for (const us of map.values()) if (us.length > 1) n += us.length;
  return n;
}

function comfortPenalty(plans: Iterable<BedPlan>, mode: Mode): number {
  let p = 0;
  for (const plan of plans) {
    p += plan.adultsOnBunks * 10;
    if (mode === "privacy") p += plan.childrenSharing * 2 + plan.couplesInDouble;
  }
  return p;
}

function score(e: { roomsUsed: number; nightly: number; sharedRoomUnits: number; comfort: number }, mode: Mode): number {
  return mode === "efficient"
    ? e.roomsUsed * 1e8 + e.nightly * 100 + e.comfort
    : e.sharedRoomUnits * 1e10 + e.comfort * 1e7 + e.nightly * 10 + e.roomsUsed;
}

function signature(u: GuestUnit): string {
  return [u.kind, u.adults, u.children, u.couples, u.separateBeds, u.privateRoom, u.access].join("|");
}

/** Most-constrained units first so dead ends are found early. */
function orderUnits(units: GuestUnit[]): GuestUnit[] {
  const weight = (u: GuestUnit) =>
    (u.access === "wheelchair" ? 1000 : u.access === "ground-floor" ? 500 : 0) + (u.privateRoom ? 100 : 0) + unitSize(u) * 10 + u.couples;
  return [...units].sort((a, b) => weight(b) - weight(a) || signature(a).localeCompare(signature(b)) || a.id.localeCompare(b.id));
}

function search(units: GuestUnit[], rooms: Room[], mode: Mode, nodeLimit: number): Evaluated | null {
  const ordered = orderUnits(units);
  const roomIndex = new Map(rooms.map((r, i) => [r.id, i]));
  const contents = new Map<string, GuestUnit[]>();
  const placedRoom: number[] = [];
  let best: Evaluated | null = null;
  let bestScore = Infinity;
  let nodes = 0;

  const nightlyOf = (room: Room, us: GuestUnit[]) => nightlyRoomRate(room, us.reduce((s, u) => s + unitSize(u), 0));

  // Monotone lower bound: rooms, price and sharing never decrease as units are added.
  let curNightly = 0;
  const bound = () =>
    score({ roomsUsed: contents.size, nightly: curNightly, sharedRoomUnits: sharedCount(contents), comfort: 0 }, mode);

  const recurse = (i: number) => {
    if (++nodes > nodeLimit) return;
    if (bound() >= bestScore) return;
    if (i === ordered.length) {
      const plans = new Map<string, BedPlan>();
      for (const [roomId, us] of contents) plans.set(roomId, planBeds(rooms[roomIndex.get(roomId)!], us));
      const e: Evaluated = {
        assignments: new Map([...contents].map(([k, v]) => [k, [...v]])),
        plans,
        nightly: curNightly,
        roomsUsed: contents.size,
        sharedRoomUnits: sharedCount(contents),
        comfort: comfortPenalty(plans.values(), mode),
      };
      const s = score(e, mode);
      if (s < bestScore) {
        bestScore = s;
        best = e;
      }
      return;
    }

    const u = ordered[i];
    // Symmetry breaking: identical consecutive units go to non-decreasing room indexes.
    const minIdx = i > 0 && signature(ordered[i - 1]) === signature(u) ? placedRoom[i - 1] : 0;

    const candidates = rooms
      .map((room, idx) => ({ room, idx }))
      .filter(({ room, idx }) => idx >= minIdx && roomSuitsUnit(room, u));

    // Ordering heuristic: efficient fills open rooms first; privacy opens the snuggest new room first.
    const open = candidates.filter((c) => contents.has(c.room.id));
    const fresh = candidates.filter((c) => !contents.has(c.room.id)).sort((a, b) => a.room.capacity - b.room.capacity || a.room.rate.base - b.room.rate.base);
    const tryOrder = mode === "efficient" ? [...open, ...fresh] : [...fresh, ...open];

    for (const { room, idx } of tryOrder) {
      const existing = contents.get(room.id) ?? [];
      if (existing.length > 0 && (u.privateRoom || existing.some((x) => x.privateRoom))) continue;
      const next = [...existing, u];
      if (next.reduce((s, x) => s + unitSize(x), 0) > room.capacity) continue;
      if (!planBeds(room, next).ok) continue;
      if (!next.every((x) => roomSuitsUnit(room, x))) continue;

      const before = existing.length ? nightlyOf(room, existing) : 0;
      const after = nightlyOf(room, next);
      contents.set(room.id, next);
      curNightly += after - before;
      placedRoom[i] = idx;
      recurse(i + 1);
      curNightly -= after - before;
      if (existing.length) contents.set(room.id, existing);
      else contents.delete(room.id);
    }
  };

  recurse(0);
  return best;
}

// ---------------------------------------------------------------------------
// Relaxations for when no ideal arrangement exists
// ---------------------------------------------------------------------------

/**
 * Splits a party into couples and individuals, keeping every child with an
 * adult. Couples are only separated when the parts would still be too big.
 */
export function splitUnit(u: GuestUnit, maxRoomSize = Infinity): GuestUnit[] {
  if (unitSize(u) <= 1) return [u];
  const base = { kind: u.kind, separateBeds: u.separateBeds, privateRoom: false, access: u.access } as const;
  const build = (keepCouples: boolean) => {
    const parts: GuestUnit[] = [];
    const couples = keepCouples ? u.couples : 0;
    for (let c = 0; c < couples; c++) parts.push({ ...base, id: "", label: "", adults: 2, children: 0, couples: 1 });
    for (let a = 0; a < u.adults - couples * 2; a++) parts.push({ ...base, id: "", label: "", adults: 1, children: 0, couples: 0 });
    // Children are spread across the adult parts, round-robin.
    for (let k = 0; k < u.children; k++) parts[k % parts.length].children++;
    return parts;
  };
  let parts = build(true);
  if (parts.some((p) => unitSize(p) > maxRoomSize)) parts = build(false);
  return parts.map((p, i) => ({ ...p, id: `${u.id}#${i + 1}`, label: `${u.label} (part ${i + 1})` }));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function toOption(
  e: Evaluated,
  key: AllocationOption["key"],
  title: string,
  rooms: Room[],
  nights: number,
  compromises: string[],
): AllocationOption {
  const assignments: RoomAssignment[] = rooms
    .filter((r) => e.assignments.has(r.id))
    .map((room) => {
      const us = e.assignments.get(room.id)!;
      const guests = us.reduce((s, u) => s + unitSize(u), 0);
      return {
        roomId: room.id,
        unitIds: us.map((u) => u.id),
        guests,
        sleeping: e.plans.get(room.id)!.sleeping,
        nightlyRate: nightlyRoomRate(room, guests),
      };
    });
  const totalGuests = assignments.reduce((s, a) => s + a.guests, 0);
  const spareBeds = assignments.reduce((s, a) => s + (rooms.find((r) => r.id === a.roomId)!.capacity - a.guests), 0);
  const unitsById = new Map([...e.assignments.values()].flat().map((u) => [u.id, u]));
  const highlights: string[] = [];
  for (const a of assignments) {
    const room = rooms.find((r) => r.id === a.roomId)!;
    for (const id of a.unitIds) {
      const u = unitsById.get(id)!;
      if (u.access === "wheelchair") highlights.push(`${u.label}: wheelchair-accessible ${room.shortName}`);
      else if (u.access === "ground-floor") highlights.push(`${u.label}: ground-floor ${room.shortName}`);
      if (u.privateRoom) highlights.push(`${u.label}: private room (${room.shortName})`);
      if (u.kind === "family" && !id.includes("#")) highlights.push(`${u.label} kept together in ${room.shortName}`);
    }
    if (a.unitIds.length > 1) highlights.push(`${room.shortName} shared by ${a.unitIds.map((id) => unitsById.get(id)!.label).join(" + ")}`);
  }
  const adultsOnBunks = [...e.plans.values()].reduce((s, p) => s + p.adultsOnBunks, 0);
  if (adultsOnBunks > 0) compromises = [...compromises, `${adultsOnBunks} adult(s) sleeping on a bunk bed`];
  const totalPrice = e.nightly * nights;
  return {
    id: `${key}-${assignments.map((a) => `${a.roomId}:${a.unitIds.join("+")}`).join(",")}`,
    key,
    title,
    summary: `${assignments.length} room${assignments.length === 1 ? "" : "s"} · ${totalGuests} guests · ${nights} night${nights === 1 ? "" : "s"}`,
    assignments,
    roomsUsed: assignments.length,
    totalGuests,
    nights,
    totalPrice,
    spareBeds,
    sharedRoomUnits: e.sharedRoomUnits,
    compromises,
    highlights,
  };
}

function sameArrangement(a: Evaluated, b: Evaluated): boolean {
  if (a.assignments.size !== b.assignments.size) return false;
  for (const [roomId, us] of a.assignments) {
    const other = b.assignments.get(roomId);
    if (!other || other.map((u) => u.id).sort().join() !== us.map((u) => u.id).sort().join()) return false;
  }
  return true;
}

/**
 * Independent safety check on a finished option. Every option the engine
 * returns passes through this, so a bug in the search can never hand out an
 * over-capacity, double-booked or unsuitable room.
 */
export function verifyOption(option: AllocationOption, units: GuestUnit[], rooms: Room[], bookings: Booking[], req: StayRequest): string[] {
  const problems: string[] = [];
  const byId = new Map(units.map((u) => [u.id, u]));
  const seen = new Set<string>();
  for (const a of option.assignments) {
    const room = rooms.find((r) => r.id === a.roomId);
    if (!room) {
      problems.push(`Unknown room ${a.roomId}`);
      continue;
    }
    const us = a.unitIds.map((id) => byId.get(id)).filter((u): u is GuestUnit => !!u);
    if (us.length !== a.unitIds.length) problems.push(`${room.shortName}: unknown guest party`);
    const guests = us.reduce((s, u) => s + unitSize(u), 0);
    if (guests !== a.guests) problems.push(`${room.shortName}: guest count mismatch`);
    if (guests > room.capacity) problems.push(`${room.shortName}: over capacity (${guests}/${room.capacity})`);
    if (!isRoomAvailable(room.id, bookings, req.checkIn, req.checkOut)) problems.push(`${room.shortName}: not available`);
    if (!planBeds(room, us).ok) problems.push(`${room.shortName}: bed requirements not met`);
    for (const u of us) {
      if (!roomSuitsUnit(room, u)) problems.push(`${room.shortName}: unsuitable for ${u.label}`);
      if (u.privateRoom && us.length > 1) problems.push(`${room.shortName}: ${u.label} needs a private room`);
      if (seen.has(u.id)) problems.push(`${u.label} allocated twice`);
      seen.add(u.id);
    }
  }
  for (const u of units) if (!seen.has(u.id)) problems.push(`${u.label} not allocated`);
  return problems;
}

function describeDifference(a: AllocationOption, b: AllocationOption, symbol = "R"): string {
  const money = (n: number) => `${symbol}${n.toLocaleString("en-ZA").replace(/,/g, " ")}`;
  const parts: string[] = [];
  parts.push(
    `Option A uses ${a.roomsUsed} room${a.roomsUsed === 1 ? "" : "s"} for ${money(a.totalPrice)} with ${a.spareBeds} spare bed${a.spareBeds === 1 ? "" : "s"}.`,
  );
  const diff = b.totalPrice - a.totalPrice;
  const pct = a.totalPrice > 0 ? Math.round((Math.abs(diff) / a.totalPrice) * 100) : 0;
  parts.push(
    `Option B uses ${b.roomsUsed} room${b.roomsUsed === 1 ? "" : "s"} for ${money(b.totalPrice)}` +
      (diff === 0 ? " (same price)." : diff > 0 ? ` (${money(diff)} / ${pct}% more).` : ` (${money(-diff)} / ${pct}% less).`),
  );
  if (b.sharedRoomUnits < a.sharedRoomUnits) {
    parts.push(`Option B reduces room sharing: ${a.sharedRoomUnits} part(ies) share a room in A versus ${b.sharedRoomUnits} in B.`);
  } else if (b.sharedRoomUnits === a.sharedRoomUnits && b.roomsUsed === a.roomsUsed) {
    parts.push("Both options give the same level of privacy; B uses different rooms.");
  }
  if (a.compromises.length && !b.compromises.length) parts.push("Option B avoids the compromises in Option A.");
  return parts.join(" ");
}

export function allocate(req: StayRequest, opts: AllocateOptions): AllocationResult {
  const nodeLimit = opts.nodeLimit ?? 60_000;
  const empty = (errors: string[], extra: Partial<AllocationResult> = {}): AllocationResult => ({
    ok: false,
    options: [],
    errors,
    warnings: [],
    comparison: "",
    alternativeDates: [],
    availableRoomIds: [],
    ...extra,
  });

  const errors = validateStayRequest(req, opts.today);
  if (errors.length) return empty(errors);

  // Exclusive use is binding: never substitute ordinary rooms; report package availability; never quote it here.
  if (req.exclusiveUse) {
    if (req.exclusiveUse === "unspecified") {
      return empty(["Exclusive use requested: confirm with the guest whether they want the Main House (guest rooms only) or the Whole Property (including the apartment). Ordinary rooms are not offered for an exclusive-use request."]);
    }
    const pa = packageAvailability(opts.rooms, opts.bookings, req.exclusiveUse, req.checkIn, req.checkOut);
    const label = PACKAGE_LABEL[req.exclusiveUse];
    const guests = req.units.reduce((s, u) => s + unitSize(u), 0);
    if (!pa.available) {
      return empty([`${label} is NOT available for these dates: ${pa.blocked.map((r) => r.name).join(", ")} already booked or blocked. Existing bookings are never moved or cancelled. Offer other dates, or ordinary rooms only if the guest agrees to a non-exclusive stay.`]);
    }
    if (guests > pa.capacity) return empty([`${label} sleeps at most ${pa.capacity}; the guest parties hold ${guests}.`]);
    return empty([`${label} is available for these dates (all ${pa.units} units free, sleeps up to ${pa.capacity}; the parties hold ${guests}). Package pricing is not configured in this prototype, so the app does not produce an exclusive-use quote: the owner prices and approves it. Ordinary rooms are not offered in its place.`], { availableRoomIds: availableRooms(opts.rooms, opts.bookings, req.checkIn, req.checkOut).map((r) => r.id) });
  }

  const nights = nightsBetween(req.checkIn, req.checkOut);
  const rooms = availableRooms(opts.rooms, opts.bookings, req.checkIn, req.checkOut);
  const availableRoomIds = rooms.map((r) => r.id);
  const totalGuests = req.units.reduce((s, u) => s + unitSize(u), 0);
  const freeCapacity = rooms.reduce((s, r) => s + r.capacity, 0);
  const warnings: string[] = [];

  const altDates = () => (opts.suggestDates === false ? [] : suggestDates(req, opts));

  if (totalGuests > freeCapacity) {
    return empty([`${totalGuests} guests requested but only ${freeCapacity} beds are free for these dates`], {
      availableRoomIds,
      alternativeDates: altDates(),
    });
  }
  for (const u of req.units) {
    if (u.access === "wheelchair" && !rooms.some((r) => r.wheelchairAccessible))
      return empty([`${u.label} needs a wheelchair-accessible room, which is not available for these dates`], {
        availableRoomIds,
        alternativeDates: altDates(),
      });
  }

  // Strict first, then progressively relaxed arrangements, each flagged.
  type Attempt = { units: GuestUnit[]; compromises: string[] };
  const attempts: Attempt[] = [{ units: req.units, compromises: [] }];
  const maxRoom = Math.max(0, ...rooms.map((r) => r.capacity));
  const oversized = req.units.filter((u) => unitSize(u) > maxRoom);
  const splitOversized = req.units.flatMap((u) => (unitSize(u) > maxRoom ? splitUnit(u, maxRoom) : [u]));
  if (oversized.length)
    attempts.push({ units: splitOversized, compromises: oversized.map((u) => `${u.label} split across rooms (no single room is large enough)`) });
  const multi = req.units.filter((u) => unitSize(u) > 1 && !u.privateRoom);
  if (multi.length)
    attempts.push({
      units: req.units.flatMap((u) => (unitSize(u) > 1 && !u.privateRoom ? splitUnit(u, maxRoom) : [u])),
      compromises: multi.map((u) => `${u.label} split across rooms`),
    });
  const withCouples = req.units.filter((u) => u.couples > 0);
  if (withCouples.length)
    attempts.push({
      units: req.units.map((u) => (u.couples > 0 ? { ...u, couples: 0 } : u)),
      compromises: withCouples.map((u) => `${u.label}: couple(s) in separate single beds`),
    });

  for (const attempt of attempts) {
    const eff = search(attempt.units, rooms, "efficient", nodeLimit);
    if (!eff) continue;
    const priv = search(attempt.units, rooms, "privacy", nodeLimit) ?? eff;

    const optionA = toOption(eff, "efficient", "Option A · Most efficient", rooms, nights, attempt.compromises);
    let optionB: AllocationOption | null = null;
    if (!sameArrangement(eff, priv)) {
      optionB = toOption(priv, "privacy", "Option B · More privacy & comfort", rooms, nights, attempt.compromises);
    } else {
      // Same arrangement either way: offer the best arrangement in different rooms instead.
      let bestAlt: Evaluated | null = null;
      for (const roomId of eff.assignments.keys()) {
        const alt = search(attempt.units, rooms.filter((r) => r.id !== roomId), "privacy", nodeLimit);
        if (alt && (!bestAlt || score(alt, "privacy") < score(bestAlt, "privacy"))) bestAlt = alt;
      }
      if (bestAlt) optionB = toOption(bestAlt, "alternative", "Option B · Alternative rooms", rooms, nights, attempt.compromises);
      else warnings.push("Only one arrangement is possible for these dates.");
    }

    const options = [optionA, ...(optionB ? [optionB] : [])];
    for (const o of options) {
      const problems = verifyOption(o, attempt.units, opts.rooms, opts.bookings, req);
      if (problems.length) throw new Error(`Allocation engine produced an invalid option: ${problems.join("; ")}`);
    }
    if (attempt.compromises.length) warnings.push("No ideal arrangement exists — the options below involve compromises.");
    return {
      ok: true,
      options,
      errors: [],
      warnings,
      comparison: optionB ? describeDifference(optionA, optionB) : "Only one arrangement is possible.",
      alternativeDates: attempt.compromises.length ? altDates() : [],
      availableRoomIds,
    };
  }

  return empty(["No arrangement satisfies the guests' requirements with the rooms available for these dates"], {
    availableRoomIds,
    alternativeDates: altDates(),
  });
}

/** Finds nearby check-in dates (same length of stay) where a strict allocation works. */
export function suggestDates(req: StayRequest, opts: AllocateOptions, maxShift = 7, maxResults = 3): ISODate[] {
  const nights = nightsBetween(req.checkIn, req.checkOut);
  const found: ISODate[] = [];
  for (let d = 1; d <= maxShift && found.length < maxResults; d++) {
    for (const shift of [-d, d]) {
      const checkIn = addDays(req.checkIn, shift);
      if (opts.today && toUTC(checkIn) < toUTC(opts.today)) continue;
      const checkOut = addDays(checkIn, nights);
      const rooms = availableRooms(opts.rooms, opts.bookings, checkIn, checkOut);
      if (search(req.units, rooms, "efficient", Math.min(opts.nodeLimit ?? 60_000, 20_000))) found.push(checkIn);
      if (found.length >= maxResults) break;
    }
  }
  return found;
}
