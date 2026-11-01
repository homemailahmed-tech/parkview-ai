import type { AccessNeed, GuestUnit, ISODate } from "../domain/types";
import { addDays, isValidISODate, nightsBetween } from "../domain/dates";

/**
 * The structured shape an AI provider (Meta Llama or the simulator) must
 * return when interpreting a guest enquiry. Nothing here is trusted until it
 * has passed `validateExtraction`.
 */
export interface ExtractedEnquiry {
  guestName?: string;
  checkIn?: ISODate;
  checkOut?: ISODate;
  nights?: number;
  adults?: number;
  children?: number;
  /** Couples (outside families) who want a shared bed. */
  couples?: number;
  families?: { adults: number; children: number }[];
  /** Drivers needing their own private room. */
  drivers?: number;
  /** Group leaders / coaches needing their own private room. */
  groupLeaders?: number;
  wheelchairUsers?: number;
  groundFloorGuests?: number;
  /** All non-couple guests explicitly asked for separate beds. */
  separateBeds?: boolean;
  selfCatering?: boolean;
  notes?: string[];
}

export interface ExtractionCheck {
  value: ExtractedEnquiry;
  /** Fields required before a quote can be produced. */
  missing: string[];
  /** Values that were rejected or corrected. */
  issues: string[];
}

const MAX_GUESTS = 60;

function int(v: unknown, field: string, issues: string[], max = MAX_GUESTS): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > max) {
    issues.push(`Ignored invalid ${field}: ${JSON.stringify(v)}`);
    return undefined;
  }
  return n;
}

/** Coerces untrusted JSON (e.g. from an LLM) into a safe ExtractedEnquiry. */
export function validateExtraction(raw: unknown): ExtractionCheck {
  const issues: string[] = [];
  const missing0: string[] = [];
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const v: ExtractedEnquiry = {};

  if (typeof src.guestName === "string" && src.guestName.trim()) v.guestName = src.guestName.trim().slice(0, 80);

  for (const key of ["checkIn", "checkOut"] as const) {
    const d = src[key];
    if (d === undefined || d === null || d === "") continue;
    if (isValidISODate(d)) v[key] = d;
    else issues.push(`Ignored invalid ${key}: ${JSON.stringify(d)}`);
  }
  v.nights = int(src.nights, "nights", issues, 60);
  if (v.checkIn && !v.checkOut && v.nights && v.nights > 0) v.checkOut = addDays(v.checkIn, v.nights);
  if (v.checkIn && v.checkOut) {
    const n = nightsBetween(v.checkIn, v.checkOut);
    if (n < 1) {
      issues.push("Check-out was not after check-in; dates need confirming");
      delete v.checkOut;
    } else v.nights = n;
  }

  v.adults = int(src.adults, "adults", issues);
  v.children = int(src.children, "children", issues);
  v.couples = int(src.couples, "couples", issues);
  v.drivers = int(src.drivers, "drivers", issues, 10);
  v.groupLeaders = int(src.groupLeaders, "groupLeaders", issues, 10);
  v.wheelchairUsers = int(src.wheelchairUsers, "wheelchairUsers", issues, 10);
  v.groundFloorGuests = int(src.groundFloorGuests, "groundFloorGuests", issues);
  if (typeof src.separateBeds === "boolean") v.separateBeds = src.separateBeds;
  if (typeof src.selfCatering === "boolean") v.selfCatering = src.selfCatering;

  if (Array.isArray(src.families)) {
    v.families = [];
    for (const f of src.families.slice(0, 20)) {
      const fam = (f ?? {}) as Record<string, unknown>;
      const a = int(fam.adults, "family adults", issues) ?? 0;
      const c = int(fam.children, "family children", issues) ?? 0;
      if (a + c > 0) v.families.push({ adults: a, children: c });
    }
  }
  if (Array.isArray(src.notes)) v.notes = src.notes.filter((n): n is string => typeof n === "string").map((n) => n.slice(0, 200)).slice(0, 10);

  // Reconcile totals so the parts never exceed the whole.
  const famAdults = (v.families ?? []).reduce((s, f) => s + f.adults, 0);
  const famChildren = (v.families ?? []).reduce((s, f) => s + f.children, 0);
  const committedAdults = famAdults + (v.couples ?? 0) * 2 + (v.drivers ?? 0) + (v.groupLeaders ?? 0);
  if (v.adults === undefined && committedAdults > 0) {
    // The total was not stated: count the described parts, but make staff confirm it,
    // because roles (couples, drivers, leaders) are often only part of a larger group.
    v.adults = committedAdults;
    missing0.push(`confirmed total number of adults (not stated; ${committedAdults} counted from the roles described)`);
  }
  if (v.adults !== undefined && committedAdults > v.adults) {
    issues.push(`Adult count (${v.adults}) was lower than couples/families/drivers described (${committedAdults}); using ${committedAdults}`);
    v.adults = committedAdults;
  }
  if (v.children === undefined && famChildren > 0) v.children = famChildren;
  if (v.children !== undefined && famChildren > v.children) v.children = famChildren;

  const missing: string[] = [...missing0];
  if (!v.checkIn) missing.push("check-in date");
  if (!v.checkOut) missing.push("check-out date or number of nights");
  if (!v.adults) missing.push("number of adults");
  if ((v.children ?? 0) > 0 && !v.adults) missing.push("an accompanying adult");

  return { value: v, missing, issues };
}

/** Deterministically turns a validated extraction into guest parties for the allocation engine. */
export function unitsFromExtraction(ex: ExtractedEnquiry, guestName = "Guest"): GuestUnit[] {
  const units: GuestUnit[] = [];
  let n = 0;
  const id = () => `p${++n}`;
  const base = { separateBeds: false, privateRoom: false, access: "none" as AccessNeed };

  for (const [i, f] of (ex.families ?? []).entries()) {
    units.push({
      ...base,
      id: id(),
      label: (ex.families!.length > 1 ? `Family ${i + 1}` : `${guestName} family`),
      kind: "family",
      adults: f.adults,
      children: f.children,
      couples: f.adults >= 2 ? 1 : 0,
    });
  }
  for (let i = 0; i < (ex.couples ?? 0); i++) {
    units.push({ ...base, id: id(), label: `Couple ${i + 1}`, kind: "couple", adults: 2, children: 0, couples: 1 });
  }
  for (let i = 0; i < (ex.drivers ?? 0); i++) {
    units.push({ ...base, id: id(), label: `Driver ${i + 1}`, kind: "driver", adults: 1, children: 0, couples: 0, privateRoom: true, separateBeds: true });
  }
  for (let i = 0; i < (ex.groupLeaders ?? 0); i++) {
    units.push({ ...base, id: id(), label: `Group leader ${i + 1}`, kind: "group-leader", adults: 1, children: 0, couples: 0, privateRoom: true, separateBeds: true });
  }

  const usedAdults = units.reduce((s, u) => s + u.adults, 0);
  const usedChildren = units.reduce((s, u) => s + u.children, 0);
  const restAdults = Math.max(0, (ex.adults ?? 0) - usedAdults);
  let restChildren = Math.max(0, (ex.children ?? 0) - usedChildren);

  const individuals: GuestUnit[] = [];
  for (let i = 0; i < restAdults; i++) {
    individuals.push({ ...base, id: id(), label: `Guest ${i + 1}`, kind: "individual", adults: 1, children: 0, couples: 0, separateBeds: true });
  }
  units.push(...individuals);

  // Unassigned children stay with an adult: a couple first (making it a family), else an individual.
  if (restChildren > 0) {
    const host = units.find((u) => u.kind === "couple") ?? units.find((u) => u.kind === "family") ?? individuals[0];
    if (host) {
      host.children += restChildren;
      if (host.kind === "couple") {
        host.kind = "family";
        host.label = `${guestName} family`;
      }
      host.separateBeds = false;
      restChildren = 0;
    }
  }

  // Accessibility needs go to couples/families first, then individuals; never to drivers.
  const accessOrder = [...units].sort((a, b) => rank(a) - rank(b));
  let wheel = ex.wheelchairUsers ?? 0;
  let ground = ex.groundFloorGuests ?? 0;
  for (const u of accessOrder) {
    if (u.privateRoom && u.kind === "driver") continue;
    if (wheel > 0) {
      u.access = "wheelchair";
      wheel -= u.adults + u.children;
    } else if (ground > 0) {
      u.access = "ground-floor";
      ground -= u.adults + u.children;
    }
  }
  return units;
}

function rank(u: GuestUnit): number {
  return { couple: 0, family: 1, individual: 2, friends: 2, "group-leader": 3, driver: 4 }[u.kind];
}

const PEOPLE = "adults?|people|persons?|guests?|pax|players?|members?|learners?|students?|delegates?|pilgrims?|athletes?|singers?|participants?|ladies|men|women|kids|children|girls|boys|family members";

/**
 * Deterministic cross-check of the guest count against the original message: the largest
 * "<number> <people word>" phrase in the text. Used to flag interpretations that undercount a group.
 */
export function headcountMentioned(text: string): number | undefined {
  let best: number | undefined;
  const re = new RegExp(`\\b(\\d{1,3})\\s+(?:[a-z-]+\\s+)?(?:${PEOPLE})\\b`, "gi");
  for (const m of text.matchAll(re)) {
    const n = Number(m[1]);
    if (n > 0 && n <= 200 && (best === undefined || n > best)) best = n;
  }
  return best;
}
