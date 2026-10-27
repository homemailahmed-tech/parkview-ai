"use client";

import { DEMO_PROPERTY, TOTAL_CAPACITY } from "@/lib/data/property";
import { addDays, formatShortDate, rangesOverlap } from "@/lib/domain/dates";
import { formatMoney } from "@/lib/domain/money";
import { PIPELINE, STATUS_LABEL } from "@/lib/workflow/stateMachine";
import { useStore } from "./store";
import { Badge, Card, SectionTitle, StatusPill } from "./ui";
import type { AIStatus, Tab } from "./Dashboard";
import { AIStatusPanel } from "./AIStatusPanel";

export function Overview({ onOpen, onTab, status }: { onOpen: (id: string) => void; onTab: (t: Tab) => void; status: AIStatus | null }) {
  const { enquiries, bookings, today, role } = useStore();
  const tonight = bookings.filter((b) => rangesOverlap(b.checkIn, b.checkOut, today, addDays(today, 1)));
  const occupiedRooms = new Set(tonight.filter((b) => b.kind === "booking").map((b) => b.roomId)).size;
  const guestsTonight = tonight.reduce((s, b) => s + b.guests, 0);
  const pipelineValue = enquiries
    .filter((e) => e.quote && !["declined", "cancelled", "confirmed"].includes(e.status))
    .reduce((s, e) => s + (e.quote?.total ?? 0), 0);
  const confirmedValue = enquiries.filter((e) => e.status === "confirmed").reduce((s, e) => s + (e.quote?.total ?? 0), 0);
  const attention = enquiries.filter((e) => ["enquiry", "pending_approval", "awaiting_payment"].includes(e.status));

  const stats = [
    { label: "Rooms occupied tonight", value: `${occupiedRooms}/${DEMO_PROPERTY.rooms.length}`, hint: `${guestsTonight} of ${TOTAL_CAPACITY} beds` },
    { label: "New enquiries", value: enquiries.filter((e) => e.status === "enquiry").length, hint: "Waiting for a quote" },
    { label: "Open quote value", value: formatMoney(pipelineValue), hint: "Not yet confirmed" },
    { label: "Confirmed revenue", value: formatMoney(confirmedValue), hint: "Demo figures" },
  ];

  return (
    <div className="space-y-6">
      <div className="rounded-3xl bg-gradient-to-br from-brand-700 to-brand-900 p-5 text-white shadow-lg md:p-7">
        <Badge tone="amber" className="mb-3">Demo mode · fictional guests, bookings and rates</Badge>
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Good day 👋</h1>
        <p className="mt-1 max-w-xl text-sm text-brand-100">
          AI reads WhatsApp enquiries and drafts room plans and quotations. Prices, capacity and availability are always checked by the
          deterministic engine, and nothing is confirmed without owner approval and payment.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button onClick={() => onTab("inbox")} className="rounded-xl bg-white px-3.5 py-2 text-sm font-medium text-brand-800">💬 Open enquiries</button>
          <button onClick={() => onTab("maps")} className="rounded-xl bg-white/15 px-3.5 py-2 text-sm font-medium text-white ring-1 ring-white/30">🗺️ Smart Maps</button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label} className="p-4">
            <div className="text-xs font-medium text-slate-500">{s.label}</div>
            <div className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">{s.value}</div>
            <div className="text-xs text-slate-400">{s.hint}</div>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <Card className="min-w-0 p-4 lg:col-span-3">
          <SectionTitle title="Needs attention" subtitle={role === "owner" ? "You are acting as the owner" : "Switch to owner to approve quotes"} />
          <ul className="divide-y divide-slate-100">
            {attention.length === 0 && <li className="py-3 text-sm text-slate-500">All caught up.</li>}
            {attention.map((e) => (
              <li key={e.id}>
                <button onClick={() => onOpen(e.id)} className="flex w-full items-center justify-between gap-3 py-3 text-left">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-slate-900">{e.guestName}</div>
                    <div className="truncate text-xs text-slate-500">{e.messages[0]?.text}</div>
                  </div>
                  <StatusPill status={e.status} />
                </button>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="min-w-0 p-4 lg:col-span-2">
          <SectionTitle title="Pipeline" subtitle="Enquiry → Confirmed" />
          <ol className="space-y-2">
            {PIPELINE.map((s) => {
              const n = enquiries.filter((e) => e.status === s).length;
              return (
                <li key={s} className="flex items-center gap-3 text-sm">
                  <span className="w-40 shrink-0 text-slate-600">{STATUS_LABEL[s]}</span>
                  <div className="h-2 flex-1 rounded-full bg-slate-100">
                    <div className="h-2 rounded-full bg-brand-500" style={{ width: `${Math.min(100, n * 25)}%` }} />
                  </div>
                  <span className="w-5 text-right font-medium">{n}</span>
                </li>
              );
            })}
          </ol>
          <div className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500">
            Upcoming check-ins:{" "}
            {bookings
              .filter((b) => b.kind === "booking" && b.checkIn >= today)
              .sort((a, b) => a.checkIn.localeCompare(b.checkIn))
              .slice(0, 3)
              .map((b) => `${b.guestName} (${formatShortDate(b.checkIn)})`)
              .join(" · ") || "none"}
          </div>
        </Card>
      </div>
      <AIStatusPanel status={status} />
    </div>
  );
}
