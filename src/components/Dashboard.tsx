"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { DEMO_PROPERTY } from "@/lib/data/property";
import { useStore } from "./store";
import { Badge, Button, cx } from "./ui";
import { Overview } from "./Overview";
import { Inventory } from "./Inventory";
import { Inbox } from "./Inbox";
import { Pipeline } from "./Pipeline";
import { SmartMapsView } from "./maps/SmartMapsView";

export type Tab = "overview" | "inbox" | "rooms" | "quotes" | "maps";

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "overview", label: "Overview", icon: "🏠" },
  { id: "inbox", label: "Enquiries", icon: "💬" },
  { id: "quotes", label: "Bookings", icon: "📋" },
  { id: "rooms", label: "Rooms", icon: "🛏️" },
  { id: "maps", label: "Smart Maps", icon: "🗺️" },
];

export interface AIStatus {
  ai: {
    kind: "simulation" | "meta" | "dev-model";
    provider: "simulation" | "meta-model-api" | "groq" | "openrouter" | "open-weight";
    label: string;
    modelClass: "meta-model-api" | "meta-open-weight" | "non-meta-dev" | null;
    model: string | null;
    host: string | null;
    jsonMode: string | null;
    configIssue: string | null;
    warnings: string[];
    liveCallsRemainingToday: number | null;
    connectionTestEnabled: boolean;
  };
  maps: { places: string; routing: string; notes: string[] };
}

export function Dashboard() {
  const store = useStore();
  const [tab, setTab] = useState<Tab>("overview");
  const [selected, setSelected] = useState<string | null>(null);
  const [status, setStatus] = useState<AIStatus | null>(null);

  useEffect(() => {
    fetch("/api/ai/status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  const open = (id: string) => {
    setSelected(id);
    setTab("inbox");
  };

  const attention = store.enquiries.filter((e) => e.status === "pending_approval").length;

  return (
    <div className="mx-auto flex min-h-screen max-w-7xl flex-col md:flex-row">
      {/* Sidebar (desktop) */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-black/5 bg-white/70 p-4 backdrop-blur md:flex">
        <Brand />
        <nav className="mt-6 space-y-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cx(
                "flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-medium",
                tab === t.id ? "bg-brand-50 text-brand-800" : "text-slate-600 hover:bg-slate-50",
              )}
            >
              <span>{t.icon}</span>
              {t.label}
              {t.id === "quotes" && attention > 0 && <Badge tone="amber" className="ml-auto">{attention}</Badge>}
            </button>
          ))}
        </nav>
        <div className="mt-auto space-y-3">
          <RoleSwitch />
          <button onClick={() => confirm("Reset all demo data?") && store.reset()} className="text-xs text-slate-400 hover:text-slate-600">
            Reset demo data
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="sticky top-0 z-[500] border-b border-black/5 bg-sand-50/90 px-4 py-3 backdrop-blur md:px-6">
          <div className="flex items-center justify-between gap-3">
            <div className="md:hidden">
              <Brand compact />
            </div>
            <div className="hidden text-sm text-slate-500 md:block">{DEMO_PROPERTY.name} · fictional demo property</div>
            <div className="flex min-w-0 items-center gap-2">
              <AIModeBadge status={status} />
              <div className="md:hidden">
                <RoleSwitch compact />
              </div>
            </div>
          </div>
        </header>

        <main className="min-w-0 flex-1 px-4 pb-28 pt-4 md:px-6 md:pb-10">
          {tab === "overview" && <Overview onOpen={open} onTab={setTab} status={status} />}
          {tab === "inbox" && <Inbox selected={selected} onSelect={setSelected} />}
          {tab === "quotes" && <Pipeline onOpen={open} />}
          {tab === "rooms" && <Inventory />}
          {tab === "maps" && <SmartMapsView status={status} />}
        </main>
      </div>

      {/* Bottom nav (mobile) */}
      <nav className="fixed inset-x-0 bottom-0 z-[600] grid grid-cols-5 border-t border-black/10 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cx("relative flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium", tab === t.id ? "text-brand-700" : "text-slate-500")}
          >
            <span className="text-lg leading-none">{t.icon}</span>
            {t.label}
            {t.id === "quotes" && attention > 0 && (
              <span className="absolute right-3 top-1 h-4 min-w-4 rounded-full bg-amber-500 px-1 text-[10px] leading-4 text-white">{attention}</span>
            )}
          </button>
        ))}
      </nav>
    </div>
  );
}

function Brand({ compact }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 text-lg text-white">🌿</div>
      <div className="leading-tight">
        <div className="text-sm font-semibold text-slate-900">ParkView AI</div>
        {!compact && <div className="text-xs text-slate-500">{DEMO_PROPERTY.name}</div>}
        {compact && <div className="text-[11px] text-slate-500">Parkside Demo</div>}
      </div>
    </div>
  );
}

function RoleSwitch({ compact }: { compact?: boolean }) {
  const { role, setRole, canActAsOwner, ownerAccess } = useStore();
  const [asking, setAsking] = useState(false);
  const choose = (r: "staff" | "owner") => {
    if (r === "owner" && !canActAsOwner) setAsking(true);
    else setRole(r);
  };
  return (
    <>
      <div className={cx("rounded-xl bg-slate-100 p-1 text-xs", compact ? "flex" : "grid grid-cols-2")}>
        {(["staff", "owner"] as const).map((r) => (
          <button
            key={r}
            onClick={() => choose(r)}
            className={cx("rounded-lg px-2.5 py-1.5 font-medium capitalize", role === r ? (r === "owner" ? "bg-amber-500 text-white" : "bg-white text-slate-900 shadow-sm") : "text-slate-500")}
          >
            {r === "owner" && !canActAsOwner ? "🔒 " : ""}
            {compact ? r : `Act as ${r}`}
          </button>
        ))}
      </div>
      {asking && <OwnerLoginDialog enabled={ownerAccess.ownerLoginEnabled} onClose={() => setAsking(false)} />}
    </>
  );
}

function OwnerLoginDialog({ enabled, onClose }: { enabled: boolean; onClose: () => void }) {
  const { loginOwner } = useStore();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const err = await loginOwner(code);
    setBusy(false);
    if (err) setError(err);
    else onClose();
  };
  // Portal to <body>: the header's backdrop-blur would otherwise trap this fixed overlay inside the header.
  return createPortal(
    <div className="fixed inset-0 z-[1000] flex items-end justify-center bg-black/40 p-4 sm:items-center" role="dialog" aria-modal="true" aria-label="Owner login">
      <form onSubmit={submit} className="w-full max-w-sm rounded-3xl bg-white p-5 text-left shadow-xl">
        <h2 className="font-semibold text-slate-900">🔒 Owner controls</h2>
        {enabled ? (
          <>
            <p className="mt-1 text-sm text-slate-500">Approving quotes and recording payments are owner-only. Enter the owner code.</p>
            <input
              type="password"
              autoComplete="current-password"
              autoFocus
              aria-label="Owner code"
              className="mt-3 w-full rounded-xl border border-slate-200 px-3 py-3 text-base outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
            <div className="mt-4 flex gap-2">
              <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>Cancel</Button>
              <Button type="submit" variant="owner" className="flex-1" disabled={!code || busy}>{busy ? "Checking…" : "Unlock"}</Button>
            </div>
          </>
        ) : (
          <>
            <p className="mt-1 text-sm text-slate-500">Owner controls are switched off on this deployment.</p>
            <Button type="button" variant="secondary" className="mt-4 w-full" onClick={onClose}>OK</Button>
          </>
        )}
      </form>
    </div>,
    document.body,
  );
}

function AIModeBadge({ status }: { status: AIStatus | null }) {
  if (!status) return <Badge>AI status…</Badge>;
  if (status.ai.kind === "dev-model") {
    return (
      <Badge tone="violet" className="max-w-[9rem] truncate sm:max-w-[18rem]">
        <span title="A non-Meta development model is configured — not hackathon-eligible">DEV model · not Meta</span>
      </Badge>
    );
  }
  return status.ai.kind === "meta" ? (
    <Badge tone="blue" className="max-w-[9rem] truncate sm:max-w-[18rem]">
      <span title="Configured. Each AI response shows whether it really came from Meta.">
        Ⓜ <span className="sm:hidden">Meta AI</span>
        <span className="hidden sm:inline">{status.ai.label} · {status.ai.model?.split("/").pop()}</span>
      </span>
    </Badge>
  ) : (
    <Badge tone="amber" className="max-w-[14rem] truncate" >
      <span title={status.ai.configIssue ?? "Set AI_MODE=meta with Meta Llama credentials to enable live AI"}>
        ⚙️ Simulation<span className="hidden sm:inline"> mode · not Meta AI</span>
      </span>
    </Badge>
  );
}
