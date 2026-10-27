import type { BedType, GuestUnit, Room } from "../domain/types";

export interface BedPlan {
  ok: boolean;
  reason?: string;
  sleeping: string[];
  /** Adults placed on a bunk — allowed but uncomfortable. */
  adultsOnBunks: number;
  /** Children sharing a bed with another child. */
  childrenSharing: number;
  /** Couples placed in a double (rather than a queen). */
  couplesInDouble: number;
  spareSpaces: number;
}

interface Slot {
  label: string;
  bunk: boolean;
}

interface SharedBed {
  type: "queen" | "double";
  label: string;
}

const BED_NAME: Record<BedType, string> = { queen: "Queen bed", double: "Double bed", single: "Single bed", bunk: "Bunk" };

export function sleepingSpaces(room: Room): number {
  return room.beds.reduce((s, b) => s + b.count * (b.type === "single" ? 1 : 2), 0);
}

export function unitSize(u: GuestUnit): number {
  return u.adults + u.children;
}

/**
 * Works out who sleeps where in a room. Couples need a shared queen/double
 * bed; guests needing separate beds get a single, a bunk level, or a
 * queen/double to themselves; children within the same unit may share a bed.
 * Guests from different units never share a bed.
 */
export function planBeds(room: Room, units: GuestUnit[]): BedPlan {
  const fail = (reason: string): BedPlan => ({
    ok: false,
    reason,
    sleeping: [],
    adultsOnBunks: 0,
    childrenSharing: 0,
    couplesInDouble: 0,
    spareSpaces: 0,
  });

  const guests = units.reduce((s, u) => s + unitSize(u), 0);
  if (guests > room.capacity) return fail(`${room.shortName} sleeps ${room.capacity}; ${guests} guests requested`);

  // Prefer queens for couples, then doubles.
  const shared: SharedBed[] = [];
  const slots: Slot[] = [];
  for (const bed of [...room.beds].sort((a, b) => order(a.type) - order(b.type))) {
    for (let i = 0; i < bed.count; i++) {
      const n = bed.count > 1 ? ` ${i + 1}` : "";
      if (bed.type === "queen" || bed.type === "double") shared.push({ type: bed.type, label: `${BED_NAME[bed.type]}${n}` });
      else if (bed.type === "single") slots.push({ label: `Single bed${n}`, bunk: false });
      else {
        slots.push({ label: `Bunk${n} (bottom)`, bunk: true });
        slots.push({ label: `Bunk${n} (top)`, bunk: true });
      }
    }
  }

  const sleeping: string[] = [];
  let couplesInDouble = 0;
  let adultsOnBunks = 0;
  let childrenSharing = 0;

  // 1. Couples take shared beds.
  for (const u of units) {
    const couples = u.separateBeds ? 0 : u.couples;
    for (let c = 0; c < couples; c++) {
      const bed = shared.shift();
      if (!bed) return fail(`${room.shortName} has no shared bed for every couple`);
      if (bed.type === "double") couplesInDouble++;
      sleeping.push(`${bed.label} — ${u.label} (couple)`);
    }
  }

  // 2. Guests who need their own bed.
  type Person = { unit: GuestUnit; child: boolean };
  const soloAdults: Person[] = [];
  const soloChildren: Person[] = [];
  const shareableChildren = new Map<GuestUnit, number>();
  for (const u of units) {
    const couples = u.separateBeds ? 0 : u.couples;
    for (let i = 0; i < u.adults - couples * 2; i++) soloAdults.push({ unit: u, child: false });
    if (u.separateBeds) for (let i = 0; i < u.children; i++) soloChildren.push({ unit: u, child: true });
    else if (u.children > 0) shareableChildren.set(u, u.children);
  }

  const takeSlot = (preferBunk: boolean): Slot | undefined => {
    const idx = slots.findIndex((s) => s.bunk === preferBunk);
    return idx >= 0 ? slots.splice(idx, 1)[0] : slots.shift();
  };
  const place = (p: Person, preferBunk: boolean): boolean => {
    const slot = takeSlot(preferBunk);
    const who = `${p.unit.label} (${p.child ? "child" : "adult"})`;
    if (slot) {
      if (slot.bunk && !p.child) adultsOnBunks++;
      sleeping.push(`${slot.label} — ${who}`);
      return true;
    }
    const bed = shared.shift();
    if (!bed) return false;
    sleeping.push(`${bed.label} — ${who}`);
    return true;
  };

  // Adults prefer proper singles; children are happy on bunks.
  for (const p of soloAdults) if (!place(p, false)) return fail(`${room.shortName} lacks enough separate beds`);
  for (const p of soloChildren) if (!place(p, true)) return fail(`${room.shortName} lacks enough separate beds`);

  // 3. Children who may share a bed with a sibling.
  for (const [u, count] of shareableChildren) {
    let remaining = count;
    if (remaining % 2 === 1) {
      if (!place({ unit: u, child: true }, true)) return fail(`${room.shortName} lacks beds for the children`);
      remaining--;
    }
    while (remaining > 0) {
      const bed = shared.shift();
      if (bed) {
        childrenSharing += 2;
        sleeping.push(`${bed.label} — ${u.label} (2 children sharing)`);
      } else {
        if (!place({ unit: u, child: true }, true) || !place({ unit: u, child: true }, true))
          return fail(`${room.shortName} lacks beds for the children`);
      }
      remaining -= 2;
    }
  }

  return {
    ok: true,
    sleeping,
    adultsOnBunks,
    childrenSharing,
    couplesInDouble,
    spareSpaces: room.capacity - guests,
  };
}

function order(t: BedType): number {
  return { queen: 0, double: 1, single: 2, bunk: 3 }[t];
}
