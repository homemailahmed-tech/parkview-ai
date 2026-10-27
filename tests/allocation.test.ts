import { describe, expect, it } from "vitest";
import { allocate, validateStayRequest, verifyOption } from "@/lib/allocation/engine";
import { planBeds } from "@/lib/allocation/beds";
import { DEMO_ROOMS, TOTAL_CAPACITY, createDemoBookings } from "@/lib/data/property";
import type { Booking, Room } from "@/lib/domain/types";
import { couple, single, unit } from "./helpers";

const room = (id: string): Room => DEMO_ROOMS.find((r) => r.id === id)!;
const stay = { checkIn: "2026-12-10", checkOut: "2026-12-13" };
const run = (units: ReturnType<typeof unit>[], bookings: Booking[] = []) =>
  allocate({ ...stay, units }, { rooms: DEMO_ROOMS, bookings });

function roomOf(result: ReturnType<typeof run>, optionIdx: number, unitId: string): string | undefined {
  return result.options[optionIdx].assignments.find((a) => a.unitIds.includes(unitId))?.roomId;
}

describe("demo property", () => {
  it("has nine rooms sleeping 29 guests", () => {
    expect(DEMO_ROOMS).toHaveLength(9);
    expect(TOTAL_CAPACITY).toBe(29);
  });
});

describe("room capacity limits", () => {
  it("never places more guests in a room than its capacity", () => {
    const units = [
      unit({ label: "Big family", kind: "family", adults: 2, couples: 1, children: 3 }),
      ...Array.from({ length: 8 }, (_, i) => single(`Player ${i + 1}`, { kind: "friends" })),
      couple("Couple A"),
      couple("Couple B"),
    ];
    const r = run(units);
    expect(r.ok).toBe(true);
    for (const o of r.options) {
      for (const a of o.assignments) expect(a.guests).toBeLessThanOrEqual(room(a.roomId).capacity);
      expect(o.totalGuests).toBe(17);
    }
  });

  it("rejects a bed plan that exceeds capacity", () => {
    const plan = planBeds(room("r7"), [unit({ adults: 3 })]);
    expect(plan.ok).toBe(false);
  });

  it("refuses a party larger than the whole property", () => {
    const r = run(Array.from({ length: 30 }, (_, i) => single(`G${i}`)));
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/only 29 beds/);
  });

  it("fills all 29 beds when the house is booked out", () => {
    const units = [
      // Every queen/double must hold two sharers to reach 29: 8 couples-in-beds + 1 pair of siblings.
      ...Array.from({ length: 7 }, (_, i) => couple(`Couple ${i + 1}`)),
      unit({ label: "Family", kind: "family", adults: 2, couples: 1, children: 2 }),
      ...Array.from({ length: 11 }, (_, i) => unit({ label: `Player ${i + 1}`, kind: "friends", adults: 1 })),
    ];
    const r = run(units);
    expect(r.ok).toBe(true);
    expect(r.options[0].roomsUsed).toBe(9);
    expect(r.options[0].spareBeds).toBe(0);
    expect(r.options[0].totalGuests).toBe(29);
  });
});

describe("couples and separate beds", () => {
  it("puts a couple in a shared queen or double bed", () => {
    const c = couple("Mr & Mrs Zulu");
    const r = run([c]);
    expect(r.ok).toBe(true);
    for (const o of r.options) {
      const a = o.assignments[0];
      expect(a.sleeping[0]).toMatch(/^(Queen|Double) bed/);
      expect(["r2", "r5"]).not.toContain(a.roomId);
    }
  });

  it("never gives a couple a room with only single beds", () => {
    const booked: Booking[] = DEMO_ROOMS.filter((r) => !["r2", "r5"].includes(r.id)).map((r, i) => ({
      id: `x${i}`, roomId: r.id, guestName: "x", checkIn: stay.checkIn, checkOut: stay.checkOut, guests: 1, kind: "booking",
    }));
    const r = run([couple("Couple")], booked);
    // Only single-bed rooms are free: the engine falls back and flags the compromise.
    expect(r.ok).toBe(true);
    expect(r.options[0].compromises.join()).toMatch(/separate single beds/);
  });

  it("gives colleagues who need separate beds their own bed each", () => {
    const a = single("Colleague A");
    const b = single("Colleague B");
    const plan = planBeds(room("r8"), [a, b]);
    expect(plan.ok).toBe(false); // one queen bed cannot hold two separate-bed guests
    const r = run([a, b]);
    expect(r.ok).toBe(true);
    for (const o of r.options) {
      const lines = o.assignments.flatMap((x) => x.sleeping);
      expect(lines).toHaveLength(2);
      expect(lines.filter((l) => /couple|sharing/.test(l))).toHaveLength(0);
    }
  });

  it("rejects contradictory requirements", () => {
    const errs = validateStayRequest({ ...stay, units: [unit({ adults: 2, couples: 1, separateBeds: true })] });
    expect(errs.join()).toMatch(/separate beds/);
  });
});

describe("accessibility", () => {
  it("assigns a wheelchair user to the accessible room", () => {
    const g = couple("Gran & Grandpa", { access: "wheelchair" });
    const r = run([g, couple("Other couple")]);
    expect(r.ok).toBe(true);
    for (let i = 0; i < r.options.length; i++) expect(roomOf(r, i, g.id)).toBe("r1");
  });

  it("assigns ground-floor guests to ground-floor rooms only", () => {
    const g = unit({ label: "Mobility", adults: 2, couples: 1, kind: "couple", access: "ground-floor" });
    const r = run([g]);
    for (let i = 0; i < r.options.length; i++) expect(room(roomOf(r, i, g.id)!).floor).toBe("ground");
  });

  it("reports when the accessible room is already booked", () => {
    const bookings: Booking[] = [{ id: "b", roomId: "r1", guestName: "x", checkIn: "2026-12-09", checkOut: "2026-12-11", guests: 2, kind: "booking" }];
    const r = run([single("Wheelchair user", { access: "wheelchair" })], bookings);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/wheelchair/);
    expect(r.alternativeDates.length).toBeGreaterThan(0);
  });
});

describe("group allocation", () => {
  const group = () => {
    const driver = single("Bus driver", { kind: "driver", privateRoom: true });
    const leader = single("Team manager", { kind: "group-leader", privateRoom: true });
    const players = Array.from({ length: 12 }, (_, i) => single(`Player ${i + 1}`, { kind: "friends" }));
    const family = unit({ label: "Coach's family", kind: "family", adults: 2, couples: 1, children: 2 });
    return { driver, leader, players, family, units: [driver, leader, family, ...players] };
  };

  it("gives drivers and group leaders private rooms", () => {
    const g = group();
    const r = run(g.units);
    expect(r.ok).toBe(true);
    for (const o of r.options) {
      for (const id of [g.driver.id, g.leader.id]) {
        const a = o.assignments.find((x) => x.unitIds.includes(id))!;
        expect(a.unitIds).toEqual([id]);
      }
    }
  });

  it("keeps families together in one room", () => {
    const g = group();
    const r = run(g.units);
    for (const o of r.options) {
      expect(o.assignments.filter((a) => a.unitIds.includes(g.family.id))).toHaveLength(1);
    }
  });

  it("produces an efficient option A and a more private option B, and explains the difference", () => {
    const r = run([couple("A"), couple("B"), single("C"), single("D")]);
    expect(r.options).toHaveLength(2);
    const [a, b] = r.options;
    expect(a.key).toBe("efficient");
    expect(b.key).toBe("privacy");
    expect(a.roomsUsed).toBeLessThan(b.roomsUsed);
    expect(b.sharedRoomUnits).toBeLessThan(a.sharedRoomUnits);
    expect(r.comparison).toMatch(/Option A/);
    expect(r.comparison).toMatch(/Option B/);
  });

  it("offers alternative rooms when efficient and private arrangements coincide", () => {
    const r = run([couple("Solo couple")]);
    expect(r.options).toHaveLength(2);
    expect(r.options[0].assignments[0].roomId).not.toBe(r.options[1].assignments[0].roomId);
  });

  it("splits a family too large for any free room, and flags it", () => {
    const fam = unit({ label: "Large family", kind: "family", adults: 2, couples: 1, children: 5 });
    const r = run([fam]);
    expect(r.ok).toBe(true);
    expect(r.options[0].compromises.join()).toMatch(/split/);
    expect(r.options[0].totalGuests).toBe(7);
  });

  it("is deterministic", () => {
    const g = group();
    expect(JSON.stringify(run(g.units))).toBe(JSON.stringify(run(g.units)));
  });

  it("completes a large group search quickly", () => {
    const t = Date.now();
    run(group().units);
    expect(Date.now() - t).toBeLessThan(3000);
  });
});

describe("conflicting bookings", () => {
  it("never allocates a room that is already booked for overlapping nights", () => {
    const bookings = createDemoBookings("2026-12-10");
    const units = [couple("A"), couple("B"), unit({ label: "Fam", kind: "family", adults: 2, couples: 1, children: 2 })];
    const r = run(units, bookings);
    expect(r.ok).toBe(true);
    const busy = new Set(["r1", "r4", "r7"]); // demo bookings overlapping 10–13 Dec
    for (const o of r.options) for (const a of o.assignments) expect(busy.has(a.roomId)).toBe(false);
    expect(r.availableRoomIds).not.toContain("r4");
  });

  it("treats check-out day as free for a new check-in", () => {
    const bookings: Booking[] = [{ id: "b", roomId: "r8", guestName: "x", checkIn: "2026-12-08", checkOut: "2026-12-10", guests: 2, kind: "booking" }];
    const r = run([couple("C")], bookings);
    expect(r.availableRoomIds).toContain("r8");
  });

  it("verifyOption catches a double-booked room", () => {
    const c = couple("C");
    const r = run([c]);
    const bad = verifyOption(r.options[0], [c], DEMO_ROOMS, [
      { id: "b", roomId: r.options[0].assignments[0].roomId, guestName: "x", checkIn: "2026-12-11", checkOut: "2026-12-12", guests: 1, kind: "booking" },
    ], { ...stay, units: [c] });
    expect(bad.join()).toMatch(/not available/);
  });

  it("suggests nearby dates when the house is full", () => {
    const bookings: Booking[] = DEMO_ROOMS.map((r, i) => ({
      id: `f${i}`, roomId: r.id, guestName: "Full house", checkIn: "2026-12-10", checkOut: "2026-12-12", guests: 1, kind: "booking",
    }));
    const r = run([couple("Late planners")], bookings);
    expect(r.ok).toBe(false);
    expect(r.alternativeDates).toContain("2026-12-12");
  });
});

describe("invalid requests", () => {
  it("rejects missing or reversed dates", () => {
    expect(validateStayRequest({ checkIn: "", checkOut: "2026-12-12", units: [couple()] })).toContain("Check-in date is missing or invalid");
    expect(validateStayRequest({ checkIn: "2026-12-12", checkOut: "2026-12-12", units: [couple()] })).toContain("Check-out must be after check-in");
    expect(validateStayRequest({ checkIn: "2026-02-30", checkOut: "2026-03-02", units: [couple()] })[0]).toMatch(/invalid/);
  });

  it("rejects no guests, unaccompanied children and impossible couples", () => {
    expect(validateStayRequest({ ...stay, units: [] })).toContain("At least one guest is required");
    expect(validateStayRequest({ ...stay, units: [unit({ adults: 0, children: 2 })] }).join()).toMatch(/accompanied/);
    expect(validateStayRequest({ ...stay, units: [unit({ adults: 1, couples: 1 })] }).join()).toMatch(/couple/);
    expect(validateStayRequest({ ...stay, units: [unit({ adults: 1.5 })] }).join()).toMatch(/whole numbers/);
  });

  it("rejects past check-in dates when today is supplied", () => {
    const r = allocate({ ...stay, units: [couple()] }, { rooms: DEMO_ROOMS, bookings: [], today: "2026-12-11" });
    expect(r.ok).toBe(false);
    expect(r.errors).toContain("Check-in date is in the past");
  });
});
