"use client";

import { useState } from "react";
import type { AIStatus } from "./Dashboard";
import { useStore } from "./store";
import { Badge, Button, Card, Notice, SectionTitle, inputClass } from "./ui";

/** Shows which language provider is configured, why live mode is off, and lets the owner run a connection test. */
export function AIStatusPanel({ status }: { status: AIStatus | null }) {
  const { role } = useStore();
  const [token, setToken] = useState("");
  const [result, setResult] = useState<{ ok: boolean; detail: string; model?: string; latencyMs?: number } | null>(null);
  const [testing, setTesting] = useState(false);

  if (!status) return null;
  const ai = status.ai;

  const test = async () => {
    setTesting(true);
    try {
      const res = await fetch("/api/ai/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
      setResult(await res.json());
    } catch (e) {
      setResult({ ok: false, detail: (e as Error).message });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card className="p-4">
      <SectionTitle title="AI provider" subtitle="Language only — prices, rooms and approvals stay deterministic" />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {ai.kind === "meta" ? <Badge tone="blue">{ai.label}</Badge> : <Badge tone="amber">Simulation mode · not Meta AI</Badge>}
        {ai.model && <Badge>{ai.model}</Badge>}
        {ai.jsonMode && <Badge>JSON: {ai.jsonMode}</Badge>}
        {ai.liveCallsRemainingToday !== null && <Badge>{ai.liveCallsRemainingToday} live calls left today</Badge>}
      </div>
      {ai.configIssue && <div className="mt-2"><Notice>{ai.configIssue}</Notice></div>}
      {ai.warnings.map((w) => <div key={w} className="mt-2"><Notice tone="blue">{w}</Notice></div>)}
      {ai.kind === "meta" && (
        <p className="mt-2 text-xs text-slate-500">
          Configured is not the same as working: each AI result is tagged “✓ Live Meta AI” only when that response really came from Meta.
        </p>
      )}
      {ai.kind === "meta" && role === "owner" && ai.connectionTestEnabled && (
        <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
          <input className={`${inputClass} max-w-xs`} type="password" placeholder="Connection test token" value={token} onChange={(e) => setToken(e.target.value)} />
          <Button variant="owner" disabled={!token || testing} onClick={test}>{testing ? "Testing…" : "Test live connection (1 small billable call)"}</Button>
        </div>
      )}
      {result && (
        <div className="mt-2">
          <Notice tone={result.ok ? "green" : "red"}>
            {result.ok ? `✓ Connected${result.model ? ` to ${result.model}` : ""}${result.latencyMs ? ` in ${result.latencyMs} ms` : ""}: “${result.detail}”` : `✗ ${result.detail}`}
          </Notice>
        </div>
      )}
    </Card>
  );
}
