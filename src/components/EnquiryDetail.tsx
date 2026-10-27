"use client";

import { useMemo, useState } from "react";
import type { AllocationResult, Enquiry, GuestUnit, StayRequest } from "@/lib/domain/types";
import { allocate } from "@/lib/allocation/engine";
import { DEMO_PROPERTY } from "@/lib/data/property";
import { buildQuote } from "@/lib/quote/pricing";
import { formatDate } from "@/lib/domain/dates";
import type { AIResult } from "@/lib/ai/types";
import type { InterpretOutput } from "@/lib/ai/service";
import { useStore } from "./store";
import { Badge, Button, Card, Notice, SourceTag, StatusPill } from "./ui";
import { PartyEditor } from "./PartyEditor";
import { AllocationView } from "./AllocationView";
import { QuotePanel } from "./QuotePanel";

export function EnquiryDetail({ enquiry, onBack }: { enquiry: Enquiry; onBack: () => void }) {
  const { updateEnquiry, bookings, today, act } = useStore();
  const [interp, setInterp] = useState<AIResult<InterpretOutput> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AllocationResult | null>(null);

  const editable = enquiry.status === "enquiry" || enquiry.status === "draft_quote";
  const request = enquiry.request;

  const interpret = async () => {
    setBusy(true);
    setError(null);
    try {
      const text = enquiry.messages.filter((m) => m.from === "guest").map((m) => m.text).join("\n");
      const res = await fetch("/api/ai/interpret", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, today }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Interpretation failed");
      const r = body as AIResult<InterpretOutput>;
      setInterp(r);
      const v = r.data.check.value;
      const next: StayRequest = { checkIn: v.checkIn ?? "", checkOut: v.checkOut ?? "", units: r.data.units };
      updateEnquiry(enquiry.id, {
        request: next,
        interpretedBy: r.source,
        guestName: enquiry.guestName === "New guest" && v.guestName ? v.guestName : enquiry.guestName,
      });
      setResult(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const findRooms = () => {
    if (!request) return;
    // Exclude bookings that came from this enquiry's own quote.
    const others = bookings.filter((b) => b.quoteId !== enquiry.quote?.id);
    setResult(allocate(request, { rooms: DEMO_PROPERTY.rooms, bookings: others, today }));
  };

  const chooseOption = (optionIdx: number) => {
    if (!request || !result) return;
    const option = result.options[optionIdx];
    const big = request.units.reduce((s, u) => s + u.adults + u.children, 0) >= 10;
    const quote = buildQuote({
      id: enquiry.quote?.id ?? `Q-${enquiry.id.slice(2)}`,
      enquiryId: enquiry.id,
      guestName: enquiry.guestName,
      request,
      option,
      property: DEMO_PROPERTY,
      discountPercent: big ? 5 : 0,
      notes: big ? "Includes 5% group discount." : "",
    });
    if (enquiry.quote) quote.version = enquiry.quote.version + 1;
    const err = act(enquiry.id, { type: enquiry.status === "enquiry" ? "create_draft" : "revise_draft", quote }, "staff");
    if (err) setError(err);
    else setResult(null);
  };

  const setRequest = (r: StayRequest) => {
    updateEnquiry(enquiry.id, { request: r });
    setResult(null);
  };

  const guests = useMemo(() => (request?.units ?? []).reduce((s, u: GuestUnit) => s + u.adults + u.children, 0), [request]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="rounded-lg px-2 py-1 text-sm text-slate-500 ring-1 ring-slate-200 lg:hidden">‹ Back</button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-semibold tracking-tight">{enquiry.guestName}</h2>
          <div className="text-xs text-slate-500">{enquiry.id} · {enquiry.phone}</div>
        </div>
        <StatusPill status={enquiry.status} />
      </div>

      {/* WhatsApp thread */}
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between bg-[#075e54] px-4 py-2 text-xs text-white/90">
          <span>WhatsApp (simulated)</span>
          <span>{new Date(enquiry.receivedAt).toLocaleString("en-ZA")}</span>
        </div>
        <div className="wa-bg space-y-2 p-3">
          {enquiry.messages.map((m, i) => (
            <div key={i} className={m.from === "guest" ? "flex justify-start" : "flex justify-end"}>
              <div className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm shadow-sm ${m.from === "guest" ? "rounded-tl-sm bg-white" : "rounded-tr-sm bg-[#d9fdd3]"}`}>
                {m.text}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {error && <Notice tone="red">{error}</Notice>}

      {/* Step 1: understand */}
      {editable && (
        <Card className="p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-semibold">1 · Understand the enquiry</h3>
              <p className="text-xs text-slate-500">The AI suggests dates and guest groups; you can correct anything before rooms are allocated.</p>
            </div>
            <Button onClick={interpret} disabled={busy}>{busy ? "Reading…" : request ? "Re-read with AI" : "✨ Read with AI"}</Button>
          </div>
          {interp && (
            <div className="mb-3 space-y-2">
              <SourceTag source={interp.source} label={interp.label} model={interp.model} modelClass={interp.modelClass} fallbackReason={interp.fallbackReason} />
              {interp.data.check.missing.length > 0 && (
                <Notice>Missing: {interp.data.check.missing.join(", ")} — ask the guest or fill in below.</Notice>
              )}
              {interp.data.check.issues.map((i) => <Notice key={i} tone="blue">{i}</Notice>)}
              {(interp.data.check.value.notes ?? []).length > 0 && (
                <div className="flex flex-wrap gap-1">{interp.data.check.value.notes!.map((n) => <Badge key={n}>{n}</Badge>)}</div>
              )}
            </div>
          )}
          {!interp && enquiry.interpretedBy && <div className="mb-3"><SourceTag source={enquiry.interpretedBy} /></div>}
          <PartyEditor request={request ?? { checkIn: "", checkOut: "", units: [] }} onChange={setRequest} />
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
            <span className="text-sm text-slate-600">
              {guests} guest{guests === 1 ? "" : "s"}
              {request?.checkIn && request.checkOut ? ` · ${formatDate(request.checkIn)} → ${formatDate(request.checkOut)}` : ""}
            </span>
            <Button onClick={findRooms} disabled={!request || guests === 0}>🛏️ Find room options</Button>
          </div>
        </Card>
      )}

      {/* Step 2: options */}
      {result && request && (
        <AllocationView result={result} request={request} guestName={enquiry.guestName} onChoose={chooseOption} />
      )}

      {/* Step 3: quote & workflow */}
      {enquiry.quote && <QuotePanel enquiry={enquiry} onError={setError} />}

      {!editable && !enquiry.quote && <Notice tone="blue">This enquiry is {enquiry.status}.</Notice>}
      {enquiry.status === "enquiry" && (
        <div className="flex justify-end">
          <Button variant="danger" onClick={() => { const err = act(enquiry.id, { type: "cancel", reason: "Closed without quote" }); if (err) setError(err); }}>Close enquiry</Button>
        </div>
      )}
    </div>
  );
}
