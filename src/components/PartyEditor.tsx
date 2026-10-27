"use client";

import { useState } from "react";
import type { AccessNeed, GuestUnit, StayRequest, UnitKind } from "@/lib/domain/types";
import { validateStayRequest } from "@/lib/allocation/engine";
import { Button, Field, Notice, inputClass } from "./ui";

const KINDS: { id: UnitKind; label: string }[] = [
  { id: "couple", label: "Couple" },
  { id: "family", label: "Family" },
  { id: "individual", label: "Individual" },
  { id: "friends", label: "Friend / team member" },
  { id: "driver", label: "Driver" },
  { id: "group-leader", label: "Group leader" },
];

function presetFor(kind: UnitKind): Partial<GuestUnit> {
  switch (kind) {
    case "couple":
      return { adults: 2, children: 0, couples: 1, separateBeds: false, privateRoom: false };
    case "family":
      return { adults: 2, children: 2, couples: 1, separateBeds: false, privateRoom: false };
    case "driver":
    case "group-leader":
      return { adults: 1, children: 0, couples: 0, separateBeds: true, privateRoom: true };
    default:
      return { adults: 1, children: 0, couples: 0, separateBeds: true, privateRoom: false };
  }
}

export function PartyEditor({ request, onChange }: { request: StayRequest; onChange: (r: StayRequest) => void }) {
  const update = (id: string, patch: Partial<GuestUnit>) =>
    onChange({ ...request, units: request.units.map((u) => (u.id === id ? { ...u, ...patch } : u)) });

  const add = (kind: UnitKind) => {
    const n = request.units.length + 1;
    const id = `p${Date.now().toString(36)}${n}`;
    const label = `${KINDS.find((k) => k.id === kind)!.label} ${request.units.filter((u) => u.kind === kind).length + 1}`;
    onChange({ ...request, units: [...request.units, { id, label, kind, access: "none", adults: 1, children: 0, couples: 0, separateBeds: false, privateRoom: false, ...presetFor(kind) }] });
  };

  const errors = request.checkIn || request.units.length ? validateStayRequest(request) : [];
  const [userExpanded, setExpanded] = useState<boolean | null>(null);
  const expanded = userExpanded ?? request.units.length <= 4;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Check-in">
          <input type="date" className={inputClass} value={request.checkIn} onChange={(e) => onChange({ ...request, checkIn: e.target.value })} />
        </Field>
        <Field label="Check-out">
          <input type="date" className={inputClass} value={request.checkOut} onChange={(e) => onChange({ ...request, checkOut: e.target.value })} />
        </Field>
      </div>

      {!expanded && (
        <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
          <div className="flex flex-wrap gap-1">
            {request.units.map((u) => (
              <span key={u.id} className="rounded-full bg-white px-2 py-0.5 text-xs text-slate-700 ring-1 ring-slate-200">
                {u.label} · {u.adults + u.children}
                {u.couples ? " 💑" : ""}
                {u.privateRoom ? " 🔒" : ""}
                {u.access === "wheelchair" ? " ♿" : u.access === "ground-floor" ? " ⬇️" : ""}
              </span>
            ))}
          </div>
          <Button variant="secondary" className="mt-2 px-2.5 py-1 text-xs" onClick={() => setExpanded(true)}>
            Edit {request.units.length} guest parties
          </Button>
        </div>
      )}

      <div className={expanded ? "space-y-2" : "hidden"}>
        {request.units.map((u) => (
          <div key={u.id} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <input className={`${inputClass} min-w-0 flex-1`} value={u.label} onChange={(e) => update(u.id, { label: e.target.value })} aria-label="Party name" />
              <select className={`${inputClass} w-auto`} value={u.kind} onChange={(e) => update(u.id, { kind: e.target.value as UnitKind, ...presetFor(e.target.value as UnitKind) })}>
                {KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
              </select>
              <button onClick={() => onChange({ ...request, units: request.units.filter((x) => x.id !== u.id) })} className="px-2 text-slate-400 hover:text-red-600" aria-label="Remove">✕</button>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-6">
              <NumberField label="Adults" value={u.adults} onChange={(v) => update(u.id, { adults: v })} />
              <NumberField label="Children" value={u.children} onChange={(v) => update(u.id, { children: v })} />
              <NumberField label="Couples" value={u.couples} onChange={(v) => update(u.id, { couples: v, separateBeds: v > 0 ? false : u.separateBeds })} />
              <label className="col-span-3 flex flex-wrap items-center gap-x-4 gap-y-1 pt-5 text-xs text-slate-700 sm:col-span-3">
                <span className="flex items-center gap-1">
                  <input type="checkbox" checked={u.separateBeds} onChange={(e) => update(u.id, { separateBeds: e.target.checked, couples: e.target.checked ? 0 : u.couples })} />
                  Separate beds
                </span>
                <span className="flex items-center gap-1">
                  <input type="checkbox" checked={u.privateRoom} onChange={(e) => update(u.id, { privateRoom: e.target.checked })} />
                  Private room
                </span>
                <select className="rounded-lg border border-slate-200 bg-white px-1.5 py-1" value={u.access} onChange={(e) => update(u.id, { access: e.target.value as AccessNeed })}>
                  <option value="none">No access needs</option>
                  <option value="ground-floor">Ground floor</option>
                  <option value="wheelchair">♿ Wheelchair</option>
                </select>
              </label>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {KINDS.map((k) => (
          <Button key={k.id} variant="secondary" className="px-2.5 py-1 text-xs" onClick={() => add(k.id)}>+ {k.label}</Button>
        ))}
      </div>
      {errors.length > 0 && <Notice tone="red">{errors.join(" · ")}</Notice>}
    </div>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <Field label={label}>
      <input
        type="number"
        min={0}
        max={30}
        className={inputClass}
        value={value}
        onChange={(e) => onChange(Math.max(0, Math.min(30, Math.floor(Number(e.target.value) || 0))))}
      />
    </Field>
  );
}
