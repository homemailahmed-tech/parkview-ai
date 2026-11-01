import { describe, expect, it } from "vitest";
import { resolveOpenQuestions, ResolutionError } from "@/lib/enquiry/openQuestions";
import { allocate } from "@/lib/allocation/engine";
import { DEMO_PROPERTY, DEMO_ROOMS } from "@/lib/data/property";
import { buildQuote } from "@/lib/quote/pricing";
import { canTransition, transition, type TransitionContext } from "@/lib/workflow/stateMachine";
import { unitsFromExtraction } from "@/lib/enquiry/extraction";
import type { Enquiry } from "@/lib/domain/types";

/* Owner requirement (Stage 5): a question is only closed by the guest's actual answer, its source
   and who received it — recorded in the audit trail. A bare checkbox cannot fabricate confirmation. */
const C = (actor: TransitionContext["actor"]): TransitionContext => ({ actor, rooms: DEMO_ROOMS, bookings: [], depositPercent: DEMO_PROPERTY.depositPercent, now: "2026-11-02T00:00:00Z" });
const GOGO = "Is gogo included in the 16 or extra?";
const AGES = "Are all 16 guests adults, any children?";
function pending(): Enquiry {
  const request = { checkIn: "2026-11-21", checkOut: "2026-11-24", units: unitsFromExtraction({ adults: 16, couples: 4 }, "Mpho") };
  const option = allocate(request, { rooms: DEMO_ROOMS, bookings: [] }).options[0];
  const quote = buildQuote({ id: "Q", enquiryId: "E", guestName: "Mpho", request, option, property: DEMO_PROPERTY, now: "2026-11-01T00:00:00Z" });
  let e: Enquiry = { id: "E", guestName: "Mpho", phone: "+27 00 000 0000", channel: "whatsapp", receivedAt: "2026-11-01T00:00:00Z", messages: [], status: "enquiry", request, events: [], openQuestions: [{ topic: "count", text: GOGO }, { topic: "ages", text: AGES }] };
  e = transition(e, { type: "create_draft", quote }, C("staff"));
  return transition(e, { type: "submit_for_approval" }, C("staff"));
}

describe("resolving open questions requires the guest's actual answer", () => {
  it("rejects a resolution without an answer, a source or the person who received it", () => {
    const e = pending();
    expect(() => resolveOpenQuestions(e, [], "staff", "t")).toThrow(ResolutionError);
    expect(() => resolveOpenQuestions(e, [{ question: GOGO, answer: " ", source: "whatsapp", confirmedBy: "Lerato" }], "staff", "t")).toThrow(/actual answer/);
    expect(() => resolveOpenQuestions(e, [{ question: GOGO, answer: "17th guest", source: "telepathy" as never, confirmedBy: "Lerato" }], "staff", "t")).toThrow(/where the answer came from/);
    expect(() => resolveOpenQuestions(e, [{ question: GOGO, answer: "17th guest", source: "phone", confirmedBy: "" }], "staff", "t")).toThrow(/who received/);
    expect(() => resolveOpenQuestions(e, [{ question: "made-up question", answer: "x y", source: "phone", confirmedBy: "Lerato" }], "staff", "t")).toThrow(/Not an open question/);
  });

  it("records the fact, the confirmed value, the source and who received it in the audit trail", () => {
    const r = resolveOpenQuestions(pending(), [{ question: GOGO, answer: "Gogo is the 17th guest", source: "whatsapp", confirmedBy: "Lerato" }], "staff", "2026-11-02T09:00:00Z");
    const ev = r.events.at(-1)!;
    expect(ev.action).toBe("resolve_question");
    expect(ev.note).toBe('[count] Is gogo included in the 16 or extra? → guest confirmed: "Gogo is the 17th guest" (via whatsapp, recorded by Lerato)');
    expect(r.resolvedQuestions?.[0]).toMatchObject({ question: GOGO, answer: "Gogo is the 17th guest", source: "whatsapp", confirmedBy: "Lerato", topic: "count" });
  });

  it("a partial answer keeps the rest open — approval stays locked until every material question is answered", () => {
    const one = resolveOpenQuestions(pending(), [{ question: GOGO, answer: "Gogo is the 17th guest", source: "phone", confirmedBy: "Lerato" }], "staff", "t");
    expect(one.openQuestions?.map((q) => q.text)).toEqual([AGES]);
    expect(canTransition(one, "owner_approve", "owner")).toBe(false);
    expect(() => transition(one, { type: "owner_approve", ownerName: "Owner" }, C("owner"))).toThrow(/Provisional/);
    const both = resolveOpenQuestions(one, [{ question: AGES, answer: "All adults", source: "phone", confirmedBy: "Lerato" }], "staff", "t");
    expect(both.openQuestions).toEqual([]);
    expect(transition(both, { type: "owner_approve", ownerName: "Owner" }, C("owner")).status).toBe("approved");
  });

  it("while questions are open, a provisional booking cannot be approved, sent or confirmed (any actor)", () => {
    const e = pending();
    for (const actor of ["owner", "staff", "system", "guest"] as const) expect(canTransition(e, "owner_approve", actor)).toBe(false);
    expect(() => transition({ ...e, status: "approved" }, { type: "send_quote" }, C("owner"))).toThrow(/Provisional/);
    expect(() => transition({ ...e, status: "awaiting_payment" }, { type: "confirm" }, C("owner"))).toThrow(/Provisional/);
  });
});
