"use client";

import { useState } from "react";
import type { Enquiry, WorkflowStatus } from "@/lib/domain/types";
import type { AIResult } from "@/lib/ai/types";
import { DEMO_PROPERTY } from "@/lib/data/property";
import { formatDate } from "@/lib/domain/dates";
import { formatMoney } from "@/lib/domain/money";
import { formatQuoteText } from "@/lib/quote/format";
import { reviseQuote } from "@/lib/quote/pricing";
import { PIPELINE, STATUS_LABEL, canTransition, type WorkflowAction } from "@/lib/workflow/stateMachine";
import { useStore } from "./store";
import { Badge, Button, Card, Field, Notice, SourceTag, cx, inputClass } from "./ui";

export function QuotePanel({ enquiry, onError }: { enquiry: Enquiry; onError: (e: string | null) => void }) {
  const { act, role, ownerName, updateEnquiry } = useStore();
  const quote = enquiry.quote!;
  const [discount, setDiscount] = useState(quote.discountPercent);
  const [notes, setNotes] = useState(quote.notes);
  const [intro, setIntro] = useState<AIResult<string> | null>(null);
  const [copied, setCopied] = useState(false);
  const [drafting, setDrafting] = useState(false);

  const isDraft = enquiry.status === "draft_quote";
  const text = formatQuoteText(quote, DEMO_PROPERTY, { intro: intro?.data });
  const dirty = discount !== quote.discountPercent || notes !== quote.notes;

  const run = (action: WorkflowAction, actor?: "guest" | "staff" | "owner") => {
    const err = act(enquiry.id, action, actor);
    onError(err);
    return !err;
  };

  const saveRevision = () => {
    try {
      run({ type: "revise_draft", quote: reviseQuote(quote, { discountPercent: discount, notes }, DEMO_PROPERTY.depositPercent) });
    } catch (e) {
      onError((e as Error).message);
    }
  };

  const draftIntro = async () => {
    setDrafting(true);
    try {
      const res = await fetch("/api/ai/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          guestName: enquiry.guestName,
          checkIn: quote.checkIn,
          checkOut: quote.checkOut,
          optionTitle: quote.optionTitle,
          roomNames: quote.lines.map((l) => l.description),
          notes: [],
          propertyName: DEMO_PROPERTY.name,
        }),
      });
      if (res.ok) setIntro(await res.json());
    } finally {
      setDrafting(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      onError("Clipboard not available — select the text and copy it manually.");
    }
  };

  const sendQuote = () => {
    if (run({ type: "send_quote" })) {
      updateEnquiry(enquiry.id, { messages: [...enquiry.messages, { from: "house", text, at: new Date().toISOString() }] });
    }
  };

  const ownerOnly = role !== "owner";

  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold">3 · Quotation {quote.id} <span className="text-xs font-normal text-slate-400">v{quote.version}</span></h3>
          <p className="text-xs text-slate-500">{quote.optionTitle} · {formatDate(quote.checkIn)} → {formatDate(quote.checkOut)} · {quote.nights} night{quote.nights === 1 ? "" : "s"}</p>
        </div>
        {enquiry.approval && enquiry.approval.quoteVersion === quote.version && (
          <Badge tone="green">✔ Approved by {enquiry.approval.approvedBy}</Badge>
        )}
      </div>

      <Stepper status={enquiry.status} />
      {(enquiry.openQuestions?.length ?? 0) > 0 && (
        <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900" data-testid="provisional-banner">
          PROVISIONAL quote: {enquiry.openQuestions!.length} open question{enquiry.openQuestions!.length === 1 ? "" : "s"} (see top). Owner approval, sending and confirmation stay locked until resolved.
        </div>
      )}

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-xs sm:min-w-[480px] sm:text-sm [&_td:last-child]:whitespace-nowrap">
          <thead className="text-left text-xs text-slate-500">
            <tr>
              <th className="py-1 font-medium">Room</th>
              <th className="py-1 font-medium">Guests</th>
              <th className="py-1 text-right font-medium">Rate / night</th>
              <th className="py-1 text-right font-medium">Nights</th>
              <th className="py-1 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {quote.lines.map((l) => (
              <tr key={l.roomId}>
                <td className="py-1.5">{l.description}</td>
                <td className="py-1.5">{l.guests}</td>
                <td className="py-1.5 text-right">{formatMoney(l.nightlyRate)}</td>
                <td className="py-1.5 text-right">{l.nights}</td>
                <td className="py-1.5 text-right font-medium">{formatMoney(l.total)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="text-sm">
            <tr><td colSpan={4} className="pt-2 text-right text-slate-500">Subtotal</td><td className="pt-2 text-right">{formatMoney(quote.subtotal)}</td></tr>
            {quote.discount > 0 && <tr><td colSpan={4} className="text-right text-slate-500">Discount ({quote.discountPercent}%)</td><td className="text-right">-{formatMoney(quote.discount)}</td></tr>}
            <tr><td colSpan={4} className="text-right font-semibold">Total</td><td className="text-right text-base font-semibold">{formatMoney(quote.total)}</td></tr>
            <tr><td colSpan={4} className="text-right text-slate-500">Deposit ({DEMO_PROPERTY.depositPercent}%)</td><td className="text-right">{formatMoney(quote.deposit)}</td></tr>
          </tfoot>
        </table>
      </div>

      {isDraft && (
        <div className="mt-4 grid gap-3 sm:grid-cols-[10rem_1fr_auto] sm:items-end">
          <Field label="Discount %" hint="0–30%">
            <input type="number" min={0} max={30} className={inputClass} value={discount} onChange={(e) => setDiscount(Math.max(0, Math.min(30, Math.floor(Number(e.target.value) || 0))))} />
          </Field>
          <Field label="Notes for guest">
            <input className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Breakfast available on request" />
          </Field>
          <Button variant="secondary" disabled={!dirty} onClick={saveRevision}>Save changes</Button>
        </div>
      )}

      {/* Copyable message */}
      <div className="mt-4 rounded-2xl bg-[#efeae2] p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-medium text-slate-600">WhatsApp-ready quotation</span>
          <div className="flex gap-2">
            <Button variant="secondary" className="px-2.5 py-1 text-xs" onClick={draftIntro} disabled={drafting}>{drafting ? "Writing…" : "✨ Personalise greeting"}</Button>
            <Button variant="secondary" className="px-2.5 py-1 text-xs" onClick={copy}>{copied ? "✔ Copied" : "📋 Copy"}</Button>
          </div>
        </div>
        {intro && <div className="mb-2"><SourceTag source={intro.source} label={intro.label} model={intro.model} modelClass={intro.modelClass} fallbackReason={intro.fallbackReason} /></div>}
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-xl bg-[#d9fdd3] p-3 font-sans text-[13px] leading-relaxed text-slate-800 shadow-sm">{text}</pre>
        <p className="mt-1 text-[11px] text-slate-500">AI may only write the greeting. All figures come from the validated quote.</p>
      </div>

      {/* Workflow actions */}
      <div className="mt-4 space-y-2 border-t border-slate-100 pt-4">
        <Actions enquiry={enquiry} ownerOnly={ownerOnly} ownerName={ownerName} run={run} sendQuote={sendQuote} />
        {ownerOnly && ["pending_approval", "awaiting_payment"].includes(enquiry.status) && (
          <p className="text-xs text-amber-700">Switch to <b>owner</b> (top bar) to approve or record payment.</p>
        )}
      </div>

      <details className="mt-4 text-xs text-slate-500">
        <summary className="cursor-pointer">Audit trail ({enquiry.events.length})</summary>
        <ol className="mt-2 space-y-1">
          {enquiry.events.map((ev, i) => (
            <li key={i}>
              {new Date(ev.at).toLocaleString("en-ZA")} · <b>{ev.actor}</b> · {ev.action.replace(/_/g, " ")} → {STATUS_LABEL[ev.to]}
              {ev.note ? ` (${ev.note})` : ""}
            </li>
          ))}
        </ol>
      </details>
    </Card>
  );
}

function Actions({
  enquiry,
  ownerOnly,
  ownerName,
  run,
  sendQuote,
}: {
  enquiry: Enquiry;
  ownerOnly: boolean;
  ownerName: string;
  run: (a: WorkflowAction, actor?: "guest" | "staff" | "owner") => boolean;
  sendQuote: () => void;
}) {
  const q = enquiry.quote!;
  const s = enquiry.status;
  const can = (t: WorkflowAction["type"]) => canTransition(enquiry, t, ownerOnly ? "staff" : "owner");

  return (
    <div className="flex flex-wrap gap-2">
      {s === "draft_quote" && <Button onClick={() => run({ type: "submit_for_approval" })}>Submit for owner approval</Button>}
      {s === "pending_approval" && (
        <>
          <Button variant="owner" disabled={!can("owner_approve")} onClick={() => run({ type: "owner_approve", ownerName })}>👑 Approve quote</Button>
          <Button
            variant="danger"
            disabled={!can("owner_reject")}
            onClick={() => {
              const reason = prompt("Reason for sending back to draft?");
              if (reason) run({ type: "owner_reject", reason });
            }}
          >
            Send back
          </Button>
        </>
      )}
      {s === "approved" && <Button onClick={sendQuote}>📤 Mark as sent to guest</Button>}
      {s === "quote_sent" && (
        <>
          <Button onClick={() => run({ type: "guest_accept" }, "guest")}>Guest accepted (simulate)</Button>
          <Button variant="danger" onClick={() => run({ type: "guest_decline", reason: "Guest declined" }, "guest")}>Guest declined</Button>
        </>
      )}
      {s === "guest_accepted" && <Button onClick={() => run({ type: "request_payment" })}>Request {formatMoney(q.deposit)} deposit</Button>}
      {s === "awaiting_payment" && (
        <>
          {!enquiry.payment ? (
            <Button
              variant="owner"
              disabled={!can("record_payment")}
              onClick={() =>
                run({ type: "record_payment", payment: { simulated: true, reference: `SIM-${Date.now().toString(36).toUpperCase()}`, amount: q.deposit, receivedAt: new Date().toISOString() } })
              }
            >
              💳 Record simulated deposit
            </Button>
          ) : (
            <Badge tone="green">Simulated payment {enquiry.payment.reference} · {formatMoney(enquiry.payment.amount)}</Badge>
          )}
          <Button variant="owner" disabled={!can("confirm") || !enquiry.payment} onClick={() => run({ type: "confirm" })}>✅ Confirm booking</Button>
        </>
      )}
      {s === "confirmed" && <Notice tone="green">Booking confirmed — rooms are now blocked in the availability calendar.</Notice>}
      {["declined", "cancelled"].includes(s) && <Notice tone="red">This quote is closed ({STATUS_LABEL[s]}).</Notice>}
      {["pending_approval", "approved"].includes(s) && (
        <Button variant="ghost" onClick={() => run({ type: "revise_draft", quote: { ...q, version: q.version + 1 } })}>Edit quote (voids approval)</Button>
      )}
      {!["confirmed", "declined", "cancelled"].includes(s) && (
        <Button variant="ghost" className="ml-auto" onClick={() => confirm("Cancel this quote?") && run({ type: "cancel", reason: "Cancelled by staff" })}>Cancel</Button>
      )}
    </div>
  );
}

function Stepper({ status }: { status: WorkflowStatus }) {
  const idx = PIPELINE.indexOf(status);
  return (
    <ol className="flex gap-1 overflow-x-auto pb-1">
      {PIPELINE.map((s, i) => (
        <li key={s} className="flex min-w-[5.5rem] flex-1 flex-col items-center gap-1 text-center">
          <span className={cx("h-1.5 w-full rounded-full", idx >= 0 && i <= idx ? (status === "confirmed" ? "bg-emerald-500" : "bg-brand-500") : "bg-slate-200")} />
          <span className={cx("text-[10px] leading-tight", i === idx ? "font-semibold text-slate-900" : "text-slate-400")}>{STATUS_LABEL[s]}</span>
        </li>
      ))}
    </ol>
  );
}
