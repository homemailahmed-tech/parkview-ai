import { describe, expect, it } from "vitest";
import { createDemoBookings } from "@/lib/data/property";
import { createDemoEnquiries } from "@/lib/data/demoEnquiries";

describe("demo data", () => {
  it("seeds an inbox covering several workflow stages through the real workflow", () => {
    const base = "2026-10-27";
    const { enquiries, bookings } = createDemoEnquiries(base, createDemoBookings(base), new Date("2026-10-27T08:00:00Z"));
    const statuses = enquiries.map((e) => e.status);
    expect(statuses).toEqual(["enquiry", "enquiry", "pending_approval", "awaiting_payment", "confirmed"]);
    const confirmed = enquiries.find((e) => e.status === "confirmed")!;
    expect(confirmed.approval).toBeDefined();
    expect(confirmed.payment?.simulated).toBe(true);
    expect(bookings.some((b) => b.quoteId === confirmed.quote!.id)).toBe(true);
  });
});
