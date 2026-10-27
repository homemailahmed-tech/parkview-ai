import type { Booking, Enquiry, ISODate, StayRequest } from "../domain/types";
import { addDays } from "../domain/dates";
import { allocate } from "../allocation/engine";
import { buildQuote } from "../quote/pricing";
import { transition, type WorkflowAction } from "../workflow/stateMachine";
import { DEMO_PROPERTY } from "./property";

/** Fictional WhatsApp enquiries. Names, numbers and messages are invented for the demo. */
interface Seed {
  id: string;
  guestName: string;
  phone: string;
  message: string;
  hoursAgo: number;
  request?: StayRequest;
  advanceTo?: "pending_approval" | "awaiting_payment" | "confirmed";
}

function seeds(base: ISODate): Seed[] {
  const d = (n: number) => addDays(base, n);
  return [
    {
      id: "E-1001",
      guestName: "Lindiwe",
      phone: "+27 00 111 0001 (fictional)",
      hoursAgo: 1,
      message: `Hi, my name is Lindiwe. We are a church choir of 14 adults coming ${dayMonth(d(20))} to ${dayMonth(d(22))}. 4 couples, our bus driver needs his own room and one lady uses a wheelchair. Can you send a quote please?`,
    },
    {
      id: "E-1002",
      guestName: "Priya",
      phone: "+27 00 111 0002 (fictional)",
      hoursAgo: 3,
      message: `Hello! Family of 5 with 3 kids, arriving ${dayMonth(d(9))} for 3 nights. We'd love to stay together, self-catering would be great. Regards, Priya`,
    },
    {
      id: "E-1003",
      guestName: "Coach Mike",
      phone: "+27 00 111 0003 (fictional)",
      hoursAgo: 26,
      message: `Morning. Under-16 rugby tour: 9 players who need separate beds, 1 coach and a driver, ${dayMonth(d(15))} to ${dayMonth(d(17))}.`,
      request: {
        checkIn: d(15),
        checkOut: d(17),
        units: [
          ...Array.from({ length: 9 }, (_, i) => ({
            id: `p${i + 1}`, label: `Player ${i + 1}`, kind: "friends" as const, adults: 1, children: 0, couples: 0, separateBeds: true, privateRoom: false, access: "none" as const,
          })),
          { id: "p10", label: "Coach", kind: "group-leader", adults: 1, children: 0, couples: 0, separateBeds: true, privateRoom: true, access: "none" },
          { id: "p11", label: "Driver", kind: "driver", adults: 1, children: 0, couples: 0, separateBeds: true, privateRoom: true, access: "none" },
        ],
      },
      advanceTo: "pending_approval",
    },
    {
      id: "E-1004",
      guestName: "Mr & Mrs Govender",
      phone: "+27 00 111 0004 (fictional)",
      hoursAgo: 50,
      message: `Hi, my wife and I would like a quiet ground floor room ${dayMonth(d(11))} to ${dayMonth(d(13))} for our anniversary.`,
      request: {
        checkIn: d(11),
        checkOut: d(13),
        units: [{ id: "p1", label: "Mr & Mrs Govender", kind: "couple", adults: 2, children: 0, couples: 1, separateBeds: false, privateRoom: false, access: "ground-floor" }],
      },
      advanceTo: "awaiting_payment",
    },
    {
      id: "E-1005",
      guestName: "Dr Botha",
      phone: "+27 00 111 0005 (fictional)",
      hoursAgo: 120,
      message: `Good day, two colleagues attending a conference, separate beds please, ${dayMonth(d(2))} to ${dayMonth(d(4))}.`,
      request: {
        checkIn: d(2),
        checkOut: d(4),
        units: [
          { id: "p1", label: "Dr Botha", kind: "individual", adults: 1, children: 0, couples: 0, separateBeds: true, privateRoom: false, access: "none" },
          { id: "p2", label: "Colleague", kind: "individual", adults: 1, children: 0, couples: 0, separateBeds: true, privateRoom: false, access: "none" },
        ],
      },
      advanceTo: "confirmed",
    },
  ];
}

function dayMonth(iso: ISODate): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });
}

/** Builds the demo inbox, pushing some enquiries through the real workflow so every stage has an example. */
export function createDemoEnquiries(base: ISODate, bookings: Booking[], now: Date = new Date()): { enquiries: Enquiry[]; bookings: Booking[] } {
  const allBookings = [...bookings];
  const enquiries = seeds(base).map((s): Enquiry => {
    const receivedAt = new Date(now.getTime() - s.hoursAgo * 3_600_000).toISOString();
    let e: Enquiry = {
      id: s.id,
      guestName: s.guestName,
      phone: s.phone,
      channel: "whatsapp",
      receivedAt,
      messages: [{ from: "guest", text: s.message, at: receivedAt }],
      status: "enquiry",
      request: s.request,
      events: [],
      interpretedBy: s.request ? "manual" : undefined,
    };
    if (!s.request || !s.advanceTo) return e;

    const result = allocate(s.request, { rooms: DEMO_PROPERTY.rooms, bookings: allBookings });
    if (!result.ok) return e;
    const option = result.options[result.options.length > 1 && s.advanceTo === "awaiting_payment" ? 1 : 0];
    const quote = buildQuote({
      id: `Q-${s.id.slice(2)}`,
      enquiryId: s.id,
      guestName: s.guestName,
      request: s.request,
      option,
      property: DEMO_PROPERTY,
      discountPercent: s.request.units.length > 6 ? 5 : 0,
      notes: s.request.units.length > 6 ? "Includes 5% group discount." : "",
      now: receivedAt,
    });
    const steps: [WorkflowAction, "staff" | "owner" | "guest"][] = [
      [{ type: "create_draft", quote }, "staff"],
      [{ type: "submit_for_approval" }, "staff"],
    ];
    if (s.advanceTo !== "pending_approval") {
      steps.push(
        [{ type: "owner_approve", ownerName: "Demo Owner" }, "owner"],
        [{ type: "send_quote" }, "staff"],
        [{ type: "guest_accept" }, "guest"],
        [{ type: "request_payment" }, "staff"],
      );
    }
    if (s.advanceTo === "confirmed") {
      steps.push(
        [{ type: "record_payment", payment: { simulated: true, reference: "SIM-DEMO-1005", amount: quote.deposit, receivedAt } }, "owner"],
        [{ type: "confirm" }, "owner"],
      );
    }
    for (const [action, actor] of steps) {
      e = transition(e, action, { actor, rooms: DEMO_PROPERTY.rooms, bookings: allBookings, depositPercent: DEMO_PROPERTY.depositPercent, now: receivedAt });
    }
    if (e.status === "confirmed") {
      allBookings.push(
        ...quote.lines.map((l, i) => ({
          id: `${quote.id}-${i + 1}`, roomId: l.roomId, guestName: s.guestName, checkIn: quote.checkIn, checkOut: quote.checkOut, guests: l.guests, kind: "booking" as const, quoteId: quote.id,
        })),
      );
    }
    return e;
  });
  return { enquiries, bookings: allBookings };
}
