"use client";

import { useState } from "react";

/** Shown when DEMO_ACCESS_CODE is set: visitors enter the code the owner shared with them. */
export default function AccessPage() {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/access", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
      if (res.ok) {
        window.location.replace("/");
        return;
      }
      const body = await res.json().catch(() => ({}));
      setError(res.status === 429 ? "Too many attempts — please wait 15 minutes." : body.error ?? "Incorrect code");
    } catch {
      setError("Could not reach the server — check your connection.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-3xl border border-black/5 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600 text-xl text-white">🌿</div>
          <div>
            <h1 className="font-semibold text-slate-900">ParkView AI</h1>
            <p className="text-xs text-slate-500">Private hackathon demo · fictional data</p>
          </div>
        </div>
        <label className="block text-sm font-medium text-slate-700" htmlFor="code">
          Demo access code
        </label>
        <input
          id="code"
          type="password"
          autoComplete="current-password"
          className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-3 text-base outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoFocus
        />
        {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
        <button disabled={!code || busy} className="mt-4 w-full rounded-xl bg-brand-600 py-3 text-sm font-medium text-white disabled:opacity-50">
          {busy ? "Checking…" : "Open demo"}
        </button>
        <p className="mt-4 text-xs text-slate-400">All guests, bookings, rates and the guest house itself are fictional.</p>
      </form>
    </main>
  );
}
