"use client";

import { useState } from "react";
import type { Enquiry } from "@/lib/domain/types";
import { useStore } from "./store";
import { Button, Card, StatusPill, cx, inputClass } from "./ui";
import { EnquiryDetail } from "./EnquiryDetail";

import { HARD_ENQUIRIES } from "@/lib/data/hardEnquiries";
import { VoiceDictation } from "./VoiceDictation";

const SAMPLES = [
  "Hi, this is Ayesha. 2 couples and 3 kids (family) need rooms 18-21 December. One of us can't manage stairs. Is there Halaal food nearby?",
  "Hello, my husband and I plus our 2 children, arriving 5 January for 2 nights. We'd like to stay together.",
  "Good day. School hockey team: 10 girls, 2 teachers and our bus driver, 14 to 16 February. Girls need separate beds.",
];

export function Inbox({ selected, onSelect }: { selected: string | null; onSelect: (id: string | null) => void }) {
  const { enquiries } = useStore();
  const [composing, setComposing] = useState(false);
  const current = enquiries.find((e) => e.id === selected) ?? null;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
      <div className={cx("space-y-3", current && "hidden lg:block")}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight">Guest enquiries</h2>
          <Button onClick={() => setComposing(true)}>+ New enquiry</Button>
        </div>
        {composing && <Composer onDone={(id) => { setComposing(false); if (id) onSelect(id); }} />}
        <Card className="divide-y divide-slate-100 overflow-hidden">
          {enquiries.map((e) => (
            <EnquiryRow key={e.id} e={e} active={e.id === selected} onClick={() => onSelect(e.id)} />
          ))}
        </Card>
      </div>
      <div className={cx(!current && "hidden lg:block")}>
        {current ? (
          <EnquiryDetail key={current.id} enquiry={current} onBack={() => onSelect(null)} />
        ) : (
          <Card className="flex h-64 items-center justify-center p-6 text-sm text-slate-500">Select an enquiry to start.</Card>
        )}
      </div>
    </div>
  );
}

function EnquiryRow({ e, active, onClick }: { e: Enquiry; active: boolean; onClick: () => void }) {
  const ago = timeAgo(e.receivedAt);
  return (
    <button onClick={onClick} className={cx("flex w-full gap-3 px-4 py-3 text-left hover:bg-slate-50", active && "bg-brand-50/60")}>
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-sm font-semibold text-emerald-800">
        {e.guestName.replace(/^(Mr|Mrs|Dr|Coach)\.?\s+(&\s+\w+\s+)?/i, "").slice(0, 1).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-medium text-slate-900">{e.guestName}</span>
          <span className="shrink-0 text-[11px] text-slate-400">{ago}</span>
        </div>
        <div className="truncate text-xs text-slate-500">{e.messages.at(-1)?.text}</div>
        <div className="mt-1 flex items-center gap-2">
          <StatusPill status={e.status} />
          <span className="text-[11px] text-slate-400">{e.id} · WhatsApp</span>
        </div>
      </div>
    </button>
  );
}

function Composer({ onDone }: { onDone: (id: string | null) => void }) {
  const { addEnquiry, enquiries } = useStore();
  const [name, setName] = useState("");
  const [text, setText] = useState("");

  const submit = () => {
    if (!text.trim()) return;
    const now = new Date().toISOString();
    const n = 1001 + enquiries.length + Math.floor(Math.random() * 1000);
    const id = `E-${n}`;
    addEnquiry({
      id,
      guestName: name.trim() || "New guest",
      phone: "Fictional demo number",
      channel: "whatsapp",
      receivedAt: now,
      messages: [{ from: "guest", text: text.trim(), at: now }],
      status: "enquiry",
      events: [],
    });
    onDone(id);
  };

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2 bg-[#075e54] px-4 py-2.5 text-sm font-medium text-white">
        <span>🟢</span> Simulated WhatsApp message (no live WhatsApp connection)
      </div>
      <div className="wa-bg space-y-2 p-3">
        <input className={inputClass} placeholder="Guest name (fictional)" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="flex flex-wrap gap-1">
          {SAMPLES.map((s, i) => (
            <button key={i} onClick={() => setText(s)} className="rounded-full bg-white/90 px-2.5 py-1 text-[11px] text-slate-600 shadow-sm hover:bg-white">
              Sample {i + 1}
            </button>
          ))}
          {HARD_ENQUIRIES.map((h, i) => (
            <button key={h.id} title={h.label} onClick={() => { setText(h.text); setName(h.guestName); }} className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] text-amber-900 shadow-sm hover:bg-amber-200">
              Hard {i + 1}
            </button>
          ))}
        </div>
        <VoiceDictation onTranscript={(t) => setText((prev) => (prev.trim() ? `${prev.trim()}\n${t}` : t))} />
        <div className="flex items-end gap-2">
          <textarea
            className={cx(inputClass, "min-h-[90px] rounded-2xl")}
            placeholder="Type or paste the guest's message…"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <button onClick={submit} disabled={!text.trim()} aria-label="Add enquiry" className="mb-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#00a884] text-white disabled:opacity-40">
            ➤
          </button>
        </div>
        <div className="flex justify-end">
          <Button variant="ghost" onClick={() => onDone(null)}>Cancel</Button>
        </div>
      </div>
    </Card>
  );
}

function timeAgo(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (mins < 60) return `${mins}m`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h`;
  return `${Math.round(mins / 1440)}d`;
}
