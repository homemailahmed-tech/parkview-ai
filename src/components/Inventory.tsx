"use client";

import { useState } from "react";
import { DEMO_PROPERTY, TOTAL_CAPACITY } from "@/lib/data/property";
import { addDays, formatShortDate, rangesOverlap } from "@/lib/domain/dates";
import { formatMoney } from "@/lib/domain/money";
import { nightlyRoomRate } from "@/lib/quote/pricing";
import type { Bed, Room } from "@/lib/domain/types";
import { useStore } from "./store";
import { Badge, Card, SectionTitle, cx } from "./ui";

const DAYS = 14;

export function bedSummary(beds: Bed[]): string {
  return beds.map((b) => `${b.count > 1 ? `${b.count} × ` : ""}${b.type}${b.type === "bunk" ? " bed" : ""}`).join(" + ");
}

export function Inventory() {
  const { bookings, today } = useStore();
  const [start, setStart] = useState(today);
  const days = Array.from({ length: DAYS }, (_, i) => addDays(start, i));

  return (
    <div className="space-y-6">
      <SectionTitle
        title="Accommodation inventory"
        subtitle={`${DEMO_PROPERTY.rooms.length} rooms · ${TOTAL_CAPACITY} guests total · fictional nightly rates (ZAR)`}
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {DEMO_PROPERTY.rooms.map((r) => (
          <RoomCard key={r.id} room={r} bookedToday={bookings.some((b) => b.roomId === r.id && rangesOverlap(b.checkIn, b.checkOut, today, addDays(today, 1)))} />
        ))}
      </div>

      <Card className="p-4">
        <SectionTitle
          title="Availability"
          subtitle="Sample bookings (fictional). Check-out day is free for a new check-in."
          action={
            <div className="flex gap-1">
              <button className="rounded-lg px-2 py-1 text-sm ring-1 ring-slate-200" onClick={() => setStart(addDays(start, -7))}>‹</button>
              <button className="rounded-lg px-2 py-1 text-sm ring-1 ring-slate-200" onClick={() => setStart(today)}>Today</button>
              <button className="rounded-lg px-2 py-1 text-sm ring-1 ring-slate-200" onClick={() => setStart(addDays(start, 7))}>›</button>
            </div>
          }
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-separate border-spacing-0.5 text-xs">
            <thead>
              <tr>
                <th className="sticky left-0 bg-white pr-2 text-left font-medium text-slate-500">Room</th>
                {days.map((d) => (
                  <th key={d} className={cx("px-0.5 font-medium", d === today ? "text-brand-700" : "text-slate-500")}>{formatShortDate(d)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {DEMO_PROPERTY.rooms.map((r) => (
                <tr key={r.id}>
                  <td className="sticky left-0 whitespace-nowrap bg-white pr-2 font-medium text-slate-700">{r.shortName}</td>
                  {days.map((d) => {
                    const b = bookings.find((x) => x.roomId === r.id && rangesOverlap(x.checkIn, x.checkOut, d, addDays(d, 1)));
                    return (
                      <td
                        key={d}
                        title={b ? `${b.guestName} · ${b.checkIn} → ${b.checkOut}` : "Available"}
                        className={cx(
                          "h-7 rounded-md text-center",
                          !b && "bg-emerald-50",
                          b?.kind === "booking" && (b.quoteId ? "bg-brand-500 text-white" : "bg-brand-300 text-brand-900"),
                          b?.kind === "blocked" && "bg-slate-300 text-slate-700",
                        )}
                      >
                        {b && b.checkIn === d ? (b.kind === "blocked" ? "✕" : b.guests) : ""}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-500">
          <span className="flex items-center gap-1"><i className="h-3 w-3 rounded bg-emerald-50 ring-1 ring-emerald-200" /> Available</span>
          <span className="flex items-center gap-1"><i className="h-3 w-3 rounded bg-brand-300" /> Existing booking</span>
          <span className="flex items-center gap-1"><i className="h-3 w-3 rounded bg-brand-500" /> Confirmed via ParkView AI</span>
          <span className="flex items-center gap-1"><i className="h-3 w-3 rounded bg-slate-300" /> Blocked</span>
        </div>
      </Card>
    </div>
  );
}

function RoomCard({ room, bookedToday }: { room: Room; bookedToday: boolean }) {
  const rates = Array.from({ length: room.capacity }, (_, i) => i + 1).map((n) => ({ n, rate: nightlyRoomRate(room, n) }));
  return (
    <Card className="flex flex-col p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-slate-900">{room.name}</div>
          <div className="text-xs text-slate-500">Sleeps {room.capacity} · {bedSummary(room.beds)}</div>
        </div>
        <Badge tone={bookedToday ? "slate" : "green"}>{bookedToday ? "Occupied tonight" : "Free tonight"}</Badge>
      </div>
      <p className="mt-2 text-sm text-slate-600">{room.description}</p>
      <div className="mt-2 flex flex-wrap gap-1">
        <Badge>{room.floor === "ground" ? "Ground floor" : "First floor"}</Badge>
        {room.wheelchairAccessible && <Badge tone="blue">♿ Wheelchair accessible</Badge>}
        {room.privateEntrance && <Badge tone="violet">Private entrance</Badge>}
        {room.selfCatering && <Badge tone="amber">Self-catering</Badge>}
      </div>
      <div className="mt-auto pt-3">
        <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Nightly room rate (fictional)</div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-700">
          {rates.map(({ n, rate }) => (
            <span key={n}>
              {n} guest{n > 1 ? "s" : ""}: <b>{formatMoney(rate)}</b>
            </span>
          ))}
        </div>
      </div>
    </Card>
  );
}
