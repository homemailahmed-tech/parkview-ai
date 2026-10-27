"use client";

import { useState } from "react";
import type { AllocationResult, StayRequest } from "@/lib/domain/types";
import type { AIResult } from "@/lib/ai/types";
import { DEMO_PROPERTY } from "@/lib/data/property";
import { formatDate } from "@/lib/domain/dates";
import { formatMoney } from "@/lib/domain/money";
import { Badge, Button, Card, Notice, SourceTag, cx } from "./ui";

const roomNames = Object.fromEntries(DEMO_PROPERTY.rooms.map((r) => [r.id, r.name]));

export function AllocationView({
  result,
  request,
  guestName,
  onChoose,
}: {
  result: AllocationResult;
  request: StayRequest;
  guestName: string;
  onChoose: (idx: number) => void;
}) {
  const [explanation, setExplanation] = useState<AIResult<string> | null>(null);
  const [loading, setLoading] = useState(false);

  const explain = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/ai/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guestName, options: result.options, comparison: result.comparison, roomNames }),
      });
      if (res.ok) setExplanation(await res.json());
    } finally {
      setLoading(false);
    }
  };

  if (!result.ok) {
    return (
      <Card className="space-y-2 p-4">
        <h3 className="font-semibold">2 · Room options</h3>
        {result.errors.map((e) => <Notice key={e} tone="red">{e}</Notice>)}
        {result.alternativeDates.length > 0 && (
          <Notice tone="blue">
            Possible alternative check-in dates for the same length of stay: {result.alternativeDates.map(formatDate).join(" · ")}
          </Notice>
        )}
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold">2 · Room options</h3>
          <p className="text-xs text-slate-500">Calculated by the deterministic allocation engine — capacity, beds, access and availability verified.</p>
        </div>
        <Button variant="secondary" onClick={explain} disabled={loading}>{loading ? "Explaining…" : "✨ Explain options"}</Button>
      </div>
      {result.warnings.map((w) => <div key={w} className="mb-2"><Notice>{w}</Notice></div>)}
      {result.alternativeDates.length > 0 && (
        <div className="mb-2"><Notice tone="blue">An ideal arrangement is available if they check in on: {result.alternativeDates.map(formatDate).join(" · ")}</Notice></div>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {result.options.map((o, idx) => (
          <div key={o.id} className={cx("flex flex-col rounded-2xl border p-4", idx === 0 ? "border-brand-200 bg-brand-50/40" : "border-violet-200 bg-violet-50/40")}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-semibold">{o.title}</div>
                <div className="text-xs text-slate-500">{o.summary} · {o.spareBeds} spare bed{o.spareBeds === 1 ? "" : "s"}</div>
              </div>
              <div className="text-right">
                <div className="text-lg font-semibold">{formatMoney(o.totalPrice)}</div>
                <div className="text-[11px] text-slate-500">room-based total</div>
              </div>
            </div>
            <ul className="mt-3 space-y-2">
              {o.assignments.map((a) => (
                <li key={a.roomId} className="rounded-xl bg-white p-2.5 text-sm shadow-sm">
                  <div className="flex justify-between gap-2">
                    <span className="font-medium">{roomNames[a.roomId]}</span>
                    <span className="whitespace-nowrap text-xs text-slate-500">{a.guests} guest{a.guests === 1 ? "" : "s"} · {formatMoney(a.nightlyRate)}/night</span>
                  </div>
                  <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
                    {a.sleeping.map((s) => <li key={s}>🛏 {s}</li>)}
                  </ul>
                </li>
              ))}
            </ul>
            {o.highlights.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1">{o.highlights.map((h) => <Badge key={h} tone="green">{h}</Badge>)}</div>
            )}
            {o.compromises.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">{o.compromises.map((c) => <Badge key={c} tone="amber">⚠ {c}</Badge>)}</div>
            )}
            <Button className="mt-4" variant={idx === 0 ? "primary" : "secondary"} onClick={() => onChoose(idx)}>
              Use {o.title.split(" · ")[0]} for draft quote
            </Button>
          </div>
        ))}
      </div>

      <div className="mt-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
        <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">How the options differ (deterministic)</div>
        {result.comparison}
      </div>
      {explanation && (
        <div className="mt-3 rounded-xl border border-sky-100 bg-sky-50/60 p-3 text-sm text-slate-700">
          <div className="mb-1"><SourceTag source={explanation.source} label={explanation.label} model={explanation.model} fallbackReason={explanation.fallbackReason} /></div>
          <p className="whitespace-pre-wrap">{explanation.data}</p>
        </div>
      )}
      <p className="mt-2 text-xs text-slate-400">
        Stay: {formatDate(request.checkIn)} → {formatDate(request.checkOut)}. Rooms are not held until the booking is confirmed.
      </p>
    </Card>
  );
}
