"use client";

import { useState } from "react";
import type { AIStatus } from "./Dashboard";
import { useStore } from "./store";
import { Badge, Button, Card, Notice, SectionTitle, inputClass } from "./ui";
import type { CatalogReport } from "@/lib/ai/catalog";

const CLASS_LABEL = {
  "meta-model-api": "Eligible Meta model (Meta Model API)",
  "meta-open-weight": "Meta open-weight model (third-party host)",
  "non-meta-dev": "NON-Meta development model — not hackathon-eligible",
} as const;

/** Shows which language provider is configured, why live mode is off, and lets the owner run a connection test. */
export function AIStatusPanel({ status }: { status: AIStatus | null }) {
  const { role, ownerAccess, logoutOwner } = useStore();
  const [token, setToken] = useState("");
  const [result, setResult] = useState<{ ok: boolean; detail: string; model?: string; latencyMs?: number } | null>(null);
  const [testing, setTesting] = useState(false);
  const [catalog, setCatalog] = useState<CatalogReport | null>(null);

  if (!status) return null;
  const ai = status.ai;

  const checkCatalog = async () => {
    setTesting(true);
    try {
      const res = await fetch("/api/ai/catalog", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
      setCatalog(await res.json());
    } catch (e) {
      setCatalog({ ok: false, provider: ai.label, configuredModel: "", metaModels: [], totalModels: 0, detail: (e as Error).message });
    } finally {
      setTesting(false);
    }
  };

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
        {ai.kind === "meta" ? (
          <Badge tone="blue">{ai.label}</Badge>
        ) : ai.kind === "dev-model" ? (
          <Badge tone="violet">{ai.label}</Badge>
        ) : (
          <Badge tone="amber">Simulation mode · not Meta AI</Badge>
        )}
        {ai.modelClass && <Badge tone={ai.modelClass === "non-meta-dev" ? "red" : "green"}>{CLASS_LABEL[ai.modelClass]}</Badge>}
        {ai.model && <Badge>{ai.model}</Badge>}
        {ai.jsonMode && <Badge>JSON: {ai.jsonMode}</Badge>}
        {ai.liveCallsRemainingToday !== null && <Badge>{ai.liveCallsRemainingToday} live calls left today</Badge>}
      </div>
      {ai.configIssue && <div className="mt-2"><Notice>{ai.configIssue}</Notice></div>}
      {ai.warnings.map((w) => <div key={w} className="mt-2"><Notice tone="blue">{w}</Notice></div>)}
      {ai.kind === "meta" && (
        <p className="mt-2 text-xs text-slate-500">
          Configured is not the same as working: each AI result is tagged “✓ Live Meta AI” only when that response really came from a Meta model.
        </p>
      )}
      {role === "owner" && ai.connectionTestEnabled && (
        <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
          {!ownerAccess.owner && (
            <input className={`${inputClass} max-w-xs`} type="password" placeholder="Owner tools token" value={token} onChange={(e) => setToken(e.target.value)} />
          )}
          <Button variant="secondary" disabled={(!ownerAccess.owner && !token) || testing} onClick={checkCatalog}>List available Meta models (free, no model call)</Button>
          {ai.kind !== "simulation" && (
            <Button variant="owner" disabled={(!ownerAccess.owner && !token) || testing} onClick={test}>{testing ? "Testing…" : "Test live connection (1 small call)"}</Button>
          )}
        </div>
      )}
      {ownerAccess.owner && (
        <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-3 text-xs text-slate-500">
          <span>🔓 Signed in as owner on this device (12 hours).</span>
          <Button variant="ghost" className="px-2 py-1 text-xs" onClick={logoutOwner}>Sign out owner</Button>
        </div>
      )}
      {catalog && (
        <div className="mt-2">
          {catalog.ok ? (
            <Notice tone="blue">
              <div>
                {catalog.provider}: {catalog.metaModels.length} Meta model(s) of {catalog.totalModels} listed for this account.
                {catalog.configuredModel && ` Configured model ${catalog.configuredModelListed ? "is listed ✓" : "is NOT listed ✗"}.`}
              </div>
              <ul className="mt-1 list-disc pl-5 text-xs">
                {catalog.metaModels.slice(0, 15).map((m) => (
                  <li key={m.id}>
                    {m.id}
                    {m.free === true ? " — free" : m.free === false ? " — paid" : ""}
                  </li>
                ))}
              </ul>
            </Notice>
          ) : (
            <Notice tone="red">✗ {catalog.detail}</Notice>
          )}
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
