import type { GuestUnit } from "@/lib/domain/types";

let seq = 0;
export function unit(partial: Partial<GuestUnit> & { label?: string } = {}): GuestUnit {
  seq++;
  return {
    id: partial.id ?? `u${seq}`,
    label: partial.label ?? `Party ${seq}`,
    kind: "individual",
    adults: 1,
    children: 0,
    couples: 0,
    separateBeds: false,
    privateRoom: false,
    access: "none",
    ...partial,
  };
}

export const couple = (label = "Couple", extra: Partial<GuestUnit> = {}) =>
  unit({ label, kind: "couple", adults: 2, couples: 1, ...extra });
export const single = (label = "Guest", extra: Partial<GuestUnit> = {}) =>
  unit({ label, kind: "individual", adults: 1, separateBeds: true, ...extra });
