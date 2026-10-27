import type { ISODate } from "./types";

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

/** True for a real calendar date in YYYY-MM-DD form. */
export function isValidISODate(value: unknown): value is ISODate {
  if (typeof value !== "string" || !ISO_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function toUTC(date: ISODate): number {
  return Date.parse(`${date}T00:00:00Z`);
}

export function addDays(date: ISODate, days: number): ISODate {
  return new Date(toUTC(date) + days * 86_400_000).toISOString().slice(0, 10);
}

export function nightsBetween(checkIn: ISODate, checkOut: ISODate): number {
  return Math.round((toUTC(checkOut) - toUTC(checkIn)) / 86_400_000);
}

/** Half-open interval overlap: a guest checking out on day X frees the room for check-in on day X. */
export function rangesOverlap(aIn: ISODate, aOut: ISODate, bIn: ISODate, bOut: ISODate): boolean {
  return toUTC(aIn) < toUTC(bOut) && toUTC(bIn) < toUTC(aOut);
}

export function todayISO(now: Date = new Date()): ISODate {
  return now.toISOString().slice(0, 10);
}

export function formatDate(date: ISODate): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-ZA", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function formatShortDate(date: ISODate): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}
