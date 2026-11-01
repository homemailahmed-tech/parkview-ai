import type { AllocationOption, GuestUnit, Room } from "../domain/types";

/**
 * Post-allocation requirement checks (read-only; the allocation engine itself is unchanged).
 * Finds needs that an option does NOT demonstrably satisfy, so they are shown as genuine
 * limitations for owner review instead of being implied:
 *  - self-catering requested, but no allocated room for that party has a kitchen;
 *  - a party with a mobility need (stairs / wheelchair) in a room where an adult must use a TOP
 *    bunk — the engine cannot tell WHICH member has the need, so a person who cannot climb could
 *    end up there. (A bottom bunk needs no climbing.)
 */
export interface RequirementFlags {
  selfCatering?: boolean;
}

export function requirementIssues(option: AllocationOption, units: GuestUnit[], rooms: Room[], flags: RequirementFlags = {}): string[] {
  const issues: string[] = [];
  const room = (id: string) => rooms.find((r) => r.id === id);
  if (flags.selfCatering && !option.assignments.some((a) => room(a.roomId)?.selfCatering)) {
    issues.push("Self-catering was requested but this option has no room with a kitchen — owner to review with the guest");
  }
  for (const a of option.assignments) {
    const needy = units.filter((u) => a.unitIds.includes(u.id) && u.access !== "none");
    if (!needy.length) continue;
    const adultOnTopBunk = a.sleeping.some((s) => /^Bunk\d* \(top\)/i.test(s) && !/\(child\)/i.test(s));
    if (adultOnTopBunk) {
      const r = room(a.roomId);
      issues.push(`${needy.map((u) => u.label).join(", ")} includes a guest who cannot use stairs, and an adult must sleep on a top bunk in ${r?.name ?? a.roomId} — owner to confirm who sleeps where`);
    }
  }
  return issues;
}

/**
 * Deterministic accessibility facts for each option, e.g.
 * "Option A: Couple 1 (wheelchair user) in Room 1 · Accessible Triple — wheelchair accessible, ground floor."
 * Given to the AI so explanations mention them, and appended by the app if the AI leaves them out.
 */
export function accessibilityFacts(options: AllocationOption[], units: GuestUnit[], rooms: Room[]): string[] {
  const out: string[] = [];
  for (const o of options) {
    const parts: string[] = [];
    for (const a of o.assignments) {
      const r = rooms.find((x) => x.id === a.roomId);
      for (const u of units.filter((x) => a.unitIds.includes(x.id) && x.access !== "none")) {
        const need = u.access === "wheelchair" ? "wheelchair user" : "cannot use stairs";
        const feats = [r?.wheelchairAccessible ? "wheelchair accessible" : null, r?.floor === "ground" ? "ground floor" : "first floor"].filter(Boolean).join(", ");
        parts.push(`${u.label} (${need}) in ${r?.name ?? a.roomId} — ${feats}`);
      }
    }
    if (parts.length) out.push(`${o.title.split(" · ")[0]}: ${parts.join("; ")}.`);
  }
  return out;
}
