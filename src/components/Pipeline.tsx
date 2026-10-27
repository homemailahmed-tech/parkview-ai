"use client";

import type { WorkflowStatus } from "@/lib/domain/types";
import { formatShortDate } from "@/lib/domain/dates";
import { formatMoney } from "@/lib/domain/money";
import { STATUS_LABEL } from "@/lib/workflow/stateMachine";
import { useStore } from "./store";
import { Card, SectionTitle, StatusPill } from "./ui";

const COLUMNS: { title: string; statuses: WorkflowStatus[] }[] = [
  { title: "New & drafting", statuses: ["enquiry", "draft_quote"] },
  { title: "Owner approval", statuses: ["pending_approval", "approved"] },
  { title: "With guest", statuses: ["quote_sent", "guest_accepted", "awaiting_payment"] },
  { title: "Confirmed", statuses: ["confirmed"] },
  { title: "Closed", statuses: ["declined", "cancelled"] },
];

export function Pipeline({ onOpen }: { onOpen: (id: string) => void }) {
  const { enquiries } = useStore();
  return (
    <div>
      <SectionTitle title="Bookings & quotations" subtitle="Status tracking from enquiry to confirmed booking" />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
        {COLUMNS.map((col) => {
          const items = enquiries.filter((e) => col.statuses.includes(e.status));
          return (
            <div key={col.title} className="rounded-2xl bg-slate-100/70 p-2">
              <div className="flex items-center justify-between px-2 py-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                {col.title}
                <span>{items.length}</span>
              </div>
              <div className="space-y-2">
                {items.length === 0 && <div className="px-2 py-3 text-xs text-slate-400">Nothing here</div>}
                {items.map((e) => (
                  <button key={e.id} onClick={() => onOpen(e.id)} className="block w-full text-left">
                    <Card className="p-3 hover:ring-2 hover:ring-brand-200">
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-sm font-medium">{e.guestName}</span>
                        <span className="text-[11px] text-slate-400">{e.id}</span>
                      </div>
                      {e.quote ? (
                        <div className="mt-1 text-xs text-slate-500">
                          {formatShortDate(e.quote.checkIn)} → {formatShortDate(e.quote.checkOut)} · {e.quote.lines.length} room{e.quote.lines.length === 1 ? "" : "s"}
                          <div className="mt-0.5 text-sm font-semibold text-slate-800">{formatMoney(e.quote.total)}</div>
                        </div>
                      ) : (
                        <div className="mt-1 line-clamp-2 text-xs text-slate-500">{e.messages[0]?.text}</div>
                      )}
                      <div className="mt-2"><StatusPill status={e.status} /></div>
                      {e.status === "awaiting_payment" && (
                        <div className="mt-1 text-[11px] text-amber-700">{e.payment ? "Payment recorded — ready to confirm" : `Waiting for ${STATUS_LABEL.awaiting_payment.toLowerCase()}`}</div>
                      )}
                    </Card>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
