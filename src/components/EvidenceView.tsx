"use client";

import type { EvidenceReport, Verdict } from "@/lib/ai/evidence";
import type { AIResult } from "@/lib/ai/types";
import { SourceTag } from "./ui";

const STYLE: Record<Verdict, { mark: string; chip: string; label: string }> = {
  supported: { mark: "bg-emerald-200/80", chip: "bg-emerald-100 text-emerald-800", label: "✓ Stated by the guest" },
  uncertain: { mark: "bg-amber-200/80", chip: "bg-amber-100 text-amber-900", label: "? Uncertain — confirm" },
  conflict: { mark: "bg-red-200/80", chip: "bg-red-100 text-red-800", label: "✗ Conflicts with the message" },
  unsupported: { mark: "bg-red-200/80", chip: "bg-red-100 text-red-800", label: "✗ Not stated by the guest" },
};
const RANK: Record<Verdict, number> = { supported: 0, uncertain: 1, unsupported: 2, conflict: 3 };

/** The guest's message with every VERIFIED quote highlighted (each highlight is an exact slice of the message). */
function Highlighted({ message, report }: { message: string; report: EvidenceReport }) {
  const text = message.normalize("NFC");
  const marks: (Verdict | undefined)[] = new Array(text.length).fill(undefined);
  for (const i of report.items) {
    if (!i.span) continue;
    for (let k = i.span[0]; k < i.span[1]; k++) if (marks[k] === undefined || RANK[i.verdict] > RANK[marks[k]!]) marks[k] = i.verdict;
  }
  const parts: { text: string; v?: Verdict }[] = [];
  for (let k = 0; k < text.length; k++) {
    const last = parts[parts.length - 1];
    if (last && last.v === marks[k]) last.text += text[k];
    else parts.push({ text: text[k], v: marks[k] });
  }
  return (
    <p className="whitespace-pre-wrap rounded-2xl rounded-tl-sm bg-white px-3 py-2 text-sm leading-relaxed shadow-sm" data-testid="evidence-message">
      {parts.map((p, i) => (p.v ? <mark key={i} className={`rounded px-0.5 text-slate-900 ${STYLE[p.v].mark}`}>{p.text}</mark> : <span key={i}>{p.text}</span>))}
    </p>
  );
}

export function EvidenceView({ message, result }: { message: string; result: AIResult<EvidenceReport> }) {
  const r = result.data;
  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3" data-testid="evidence-trail">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">🔎 Evidence Trail — where does the guest say that?</h4>
        <SourceTag source={result.source} label={result.label} model={result.model} modelClass={result.modelClass} fallbackReason={result.fallbackReason} />
      </div>
      <div className="wa-bg rounded-xl p-2">
        <Highlighted message={message} report={r} />
      </div>
      <ul className="space-y-1.5 text-sm" data-testid="evidence-facts">
        {r.items.map((i) => (
          <li key={i.fact.key} className="rounded-lg bg-white px-3 py-2 shadow-sm" data-verdict={i.verdict}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{i.fact.label}: <span className="tabular-nums">{String(i.fact.value === true ? "yes" : i.fact.value)}</span></span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STYLE[i.verdict].chip}`}>{STYLE[i.verdict].label}</span>
            </div>
            {i.quote && <div className="mt-1 text-xs text-slate-600">“{i.quote}”</div>}
            <div className="mt-0.5 text-xs text-slate-500">{i.reason}</div>
          </li>
        ))}
      </ul>
      <p className="text-[11px] leading-snug text-slate-500">
        Muse Spark only points to words. Code checks that each quote is really in the message and states the number or date
        ({r.counts.supported} stated · {r.counts.uncertain} uncertain · {r.counts.conflict + r.counts.unsupported} not supported
        {r.discarded ? ` · ${r.discarded} invented quote${r.discarded === 1 ? "" : "s"} discarded` : ""}). A matching quote does not prove
        the AI understood the meaning; anything not clearly stated becomes a question for the guest.
      </p>
    </div>
  );
}
