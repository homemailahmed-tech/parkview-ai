import { describe, expect, it } from "vitest";
import { allocate } from "@/lib/allocation/engine";
import { DEMO_PROPERTY, DEMO_ROOMS } from "@/lib/data/property";
import { buildQuote, computeTotals, nightlyRoomRate, reviseQuote, verifyQuoteTotals } from "@/lib/quote/pricing";
import { formatQuoteText } from "@/lib/quote/format";
import { formatMoney } from "@/lib/domain/money";
import { couple, single, unit } from "./helpers";

const room = (id: string) => DEMO_ROOMS.find((r) => r.id === id)!;

describe("room-based pricing", () => {
  it("charges by room occupancy, not a flat per-person rate", () => {
    expect(nightlyRoomRate(room("r2"), 1)).toBe(800);
    expect(nightlyRoomRate(room("r2"), 2)).toBe(1100);
    expect(nightlyRoomRate(room("r2"), 3)).toBe(1450);
    expect(nightlyRoomRate(room("r4"), 4)).toBe(2050);
    expect(nightlyRoomRate(room("apt"), 4)).toBe(2400);
    expect(nightlyRoomRate(room("apt"), 6)).toBe(3000);
    // Per-person cost differs by room and occupancy — no flat rate assumed.
    expect(nightlyRoomRate(room("r2"), 3) / 3).not.toBe(nightlyRoomRate(room("r2"), 2) / 2);
  });

  it("refuses to price guests beyond capacity", () => {
    expect(() => nightlyRoomRate(room("r7"), 3)).toThrow(/sleeps 2/);
    expect(() => nightlyRoomRate(room("r7"), 0)).toThrow();
  });
});

describe("quotation totals", () => {
  const request = {
    checkIn: "2026-12-10",
    checkOut: "2026-12-13",
    units: [couple("A"), unit({ label: "Fam", kind: "family" as const, adults: 2, couples: 1, children: 2 }), single("C")],
  };
  const result = allocate(request, { rooms: DEMO_ROOMS, bookings: [] });

  it("totals equal the sum of nightly room rates × nights", () => {
    for (const option of result.options) {
      const q = buildQuote({ id: "Q-1", enquiryId: "E-1", guestName: "Test", request, option, property: DEMO_PROPERTY, now: "2026-10-01T00:00:00Z" });
      const expected = option.assignments.reduce((s, a) => s + nightlyRoomRate(room(a.roomId), a.guests) * 3, 0);
      expect(q.subtotal).toBe(expected);
      expect(q.total).toBe(expected);
      expect(q.total).toBe(option.totalPrice);
      expect(q.deposit).toBe(Math.round(expected / 2));
      expect(verifyQuoteTotals(q, DEMO_ROOMS, DEMO_PROPERTY.depositPercent)).toEqual([]);
    }
  });

  it("applies discounts and rounding exactly", () => {
    const lines = [{ roomId: "r2", description: "x", guests: 3, nights: 3, nightlyRate: 1450, total: 4350 }];
    expect(computeTotals(lines, 10, 50)).toEqual({ subtotal: 4350, discount: 435, total: 3915, deposit: 1958 });
    expect(() => computeTotals(lines, 50, 50)).toThrow(/Discount/);
  });

  it("revising a quote bumps the version and recomputes totals", () => {
    const q = buildQuote({ id: "Q-2", enquiryId: "E-1", guestName: "T", request, option: result.options[0], property: DEMO_PROPERTY });
    const r = reviseQuote(q, { discountPercent: 5 }, 50);
    expect(r.version).toBe(2);
    expect(r.total).toBe(q.subtotal - Math.round(q.subtotal * 0.05));
    expect(verifyQuoteTotals(r, DEMO_ROOMS, 50)).toEqual([]);
  });

  it("detects tampered quote figures", () => {
    const q = buildQuote({ id: "Q-3", enquiryId: "E-1", guestName: "T", request, option: result.options[0], property: DEMO_PROPERTY });
    expect(verifyQuoteTotals({ ...q, total: q.total - 100 }, DEMO_ROOMS, 50)).toContain("Total mismatch");
    const lines = q.lines.map((l, i) => (i === 0 ? { ...l, nightlyRate: 1 } : l));
    expect(verifyQuoteTotals({ ...q, lines }, DEMO_ROOMS, 50).join()).toMatch(/rate mismatch/);
  });

  it("formats a copyable quotation containing the validated totals", () => {
    const q = buildQuote({ id: "Q-4", enquiryId: "E-1", guestName: "Thandi", request, option: result.options[0], property: DEMO_PROPERTY });
    const text = formatQuoteText(q, DEMO_PROPERTY);
    expect(text).toContain("Thandi");
    expect(text).toContain(`Total: ${formatMoney(q.total)}`);
    expect(text).toContain("Demo quotation");
  });

  it("formats money with thin spacing", () => {
    expect(formatMoney(12500)).toBe("R12 500");
    expect(formatMoney(950)).toBe("R950");
  });
});
