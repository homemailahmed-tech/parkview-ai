import { describe, expect, it } from "vitest";
import { simulateExtraction } from "@/lib/enquiry/simulatedParser";
import { unitsFromExtraction, validateExtraction } from "@/lib/enquiry/extraction";
import { allocate } from "@/lib/allocation/engine";
import { DEMO_ROOMS } from "@/lib/data/property";

const today = "2026-10-27";

describe("simulated enquiry interpretation", () => {
  it("extracts dates, guests, couples, driver and accessibility from a WhatsApp message", () => {
    const text =
      "Hi, my name is Lindiwe. We are a church group of 14 adults coming 12-14 December. 4 couples, our bus driver needs his own room and one lady uses a wheelchair. Thanks!";
    const ex = simulateExtraction(text, today);
    expect(ex.guestName).toBe("Lindiwe");
    expect(ex.checkIn).toBe("2026-12-12");
    expect(ex.checkOut).toBe("2026-12-14");
    expect(ex.adults).toBe(14);
    expect(ex.couples).toBe(4);
    expect(ex.drivers).toBe(1);
    expect(ex.wheelchairUsers).toBe(1);
  });

  it("understands a family with nights instead of a check-out date", () => {
    const ex = simulateExtraction("Family of 5 with 3 kids arriving 3 January for 4 nights, we'd like to stay together", today);
    const check = validateExtraction(ex);
    expect(check.value.checkIn).toBe("2027-01-03");
    expect(check.value.checkOut).toBe("2027-01-07");
    expect(check.value.families?.[0]).toEqual({ adults: 2, children: 3 });
    expect(check.missing).toEqual([]);
  });

  it("rolls dates without a year into the next occurrence", () => {
    expect(simulateExtraction("arriving 5 March leaving 7 March, 2 adults", today).checkIn).toBe("2027-03-05");
  });
});

describe("validation of missing or invalid enquiry information", () => {
  it("lists missing dates and guest counts", () => {
    const check = validateExtraction(simulateExtraction("Hello, do you have rooms available?", today));
    expect(check.missing).toEqual(["check-in date", "check-out date or number of nights", "number of adults"]);
  });

  it("rejects malformed values from an AI provider", () => {
    const check = validateExtraction({ checkIn: "12/12/2026", checkOut: "2026-13-01", adults: -3, children: "two", couples: 1.5 });
    expect(check.value.checkIn).toBeUndefined();
    expect(check.value.checkOut).toBeUndefined();
    expect(check.value.adults).toBeUndefined();
    expect(check.issues.length).toBeGreaterThanOrEqual(4);
  });

  it("flags check-out before check-in", () => {
    const check = validateExtraction({ checkIn: "2026-12-14", checkOut: "2026-12-12", adults: 2 });
    expect(check.missing).toContain("check-out date or number of nights");
    expect(check.issues.join()).toMatch(/not after check-in/);
  });

  it("never lets couples/drivers exceed the stated adult count", () => {
    const check = validateExtraction({ adults: 2, couples: 2, drivers: 1 });
    expect(check.value.adults).toBe(5);
    expect(check.issues.join()).toMatch(/lower than/);
  });

  it("handles non-object input safely", () => {
    expect(validateExtraction(null).missing.length).toBe(3);
    expect(validateExtraction("garbage").missing.length).toBe(3);
  });
});

describe("guest parties from an extraction", () => {
  it("builds parties that the engine can allocate", () => {
    const ex = validateExtraction({
      checkIn: "2026-12-12",
      checkOut: "2026-12-14",
      adults: 10,
      children: 2,
      couples: 2,
      families: [{ adults: 2, children: 2 }],
      drivers: 1,
      wheelchairUsers: 1,
    }).value;
    const units = unitsFromExtraction(ex, "Lindiwe");
    expect(units.reduce((s, u) => s + u.adults, 0)).toBe(10);
    expect(units.reduce((s, u) => s + u.children, 0)).toBe(2);
    expect(units.filter((u) => u.privateRoom)).toHaveLength(1);
    expect(units.filter((u) => u.access === "wheelchair")).toHaveLength(1);
    const r = allocate({ checkIn: ex.checkIn!, checkOut: ex.checkOut!, units }, { rooms: DEMO_ROOMS, bookings: [] });
    expect(r.ok).toBe(true);
  });

  it("keeps unassigned children with an adult", () => {
    const units = unitsFromExtraction({ adults: 2, children: 2, couples: 1 }, "Smith");
    expect(units).toHaveLength(1);
    expect(units[0]).toMatchObject({ kind: "family", adults: 2, children: 2, couples: 1 });
  });
});
