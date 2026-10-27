"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { WorkflowStatus } from "@/lib/domain/types";
import { STATUS_LABEL } from "@/lib/workflow/stateMachine";

export function cx(...c: (string | false | null | undefined)[]): string {
  return c.filter(Boolean).join(" ");
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("rounded-2xl border border-black/5 bg-white shadow-sm", className)}>{children}</div>;
}

export function SectionTitle({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-slate-900">{title}</h2>
        {subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

type Variant = "primary" | "secondary" | "ghost" | "owner" | "danger";

export function Button({ variant = "primary", className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  const styles: Record<Variant, string> = {
    primary: "bg-brand-600 text-white hover:bg-brand-700 disabled:bg-brand-600/40",
    secondary: "bg-white text-slate-800 ring-1 ring-slate-200 hover:bg-slate-50 disabled:text-slate-400",
    ghost: "text-slate-600 hover:bg-slate-100 disabled:text-slate-300",
    owner: "bg-amber-500 text-white hover:bg-amber-600 disabled:bg-amber-500/40",
    danger: "bg-white text-red-700 ring-1 ring-red-200 hover:bg-red-50 disabled:text-red-300",
  };
  return (
    <button
      {...props}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-medium transition disabled:cursor-not-allowed",
        styles[variant],
        className,
      )}
    />
  );
}

export function Badge({ children, tone = "slate", className }: { children: ReactNode; tone?: "slate" | "green" | "amber" | "red" | "blue" | "violet"; className?: string }) {
  const tones = {
    slate: "bg-slate-100 text-slate-700",
    green: "bg-emerald-100 text-emerald-800",
    amber: "bg-amber-100 text-amber-800",
    red: "bg-red-100 text-red-700",
    blue: "bg-sky-100 text-sky-800",
    violet: "bg-violet-100 text-violet-800",
  } as const;
  return <span className={cx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", tones[tone], className)}>{children}</span>;
}

const STATUS_TONE: Record<WorkflowStatus, "slate" | "green" | "amber" | "red" | "blue" | "violet"> = {
  enquiry: "blue",
  draft_quote: "slate",
  pending_approval: "amber",
  approved: "violet",
  quote_sent: "violet",
  guest_accepted: "blue",
  awaiting_payment: "amber",
  confirmed: "green",
  declined: "red",
  cancelled: "red",
};

export function StatusPill({ status }: { status: WorkflowStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>;
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-slate-700">{label}</span>
      {children}
      {hint && <span className="mt-0.5 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100";

export function Notice({ tone = "amber", children }: { tone?: "amber" | "red" | "blue" | "green"; children: ReactNode }) {
  const tones = {
    amber: "border-amber-200 bg-amber-50 text-amber-900",
    red: "border-red-200 bg-red-50 text-red-800",
    blue: "border-sky-200 bg-sky-50 text-sky-900",
    green: "border-emerald-200 bg-emerald-50 text-emerald-900",
  };
  return <div className={cx("rounded-xl border px-3 py-2 text-sm", tones[tone])}>{children}</div>;
}

/** Labels where an AI-generated piece of text came from — Meta model vs simulation. */
export function SourceTag({ source, model, fallbackReason }: { source: "simulation" | "meta" | "manual"; model?: string | null; fallbackReason?: string }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {source === "meta" ? (
        <Badge tone="blue">Meta Llama{model ? ` · ${model.split("/").pop()}` : ""}</Badge>
      ) : source === "simulation" ? (
        <Badge tone="amber">SIMULATION · not Meta AI</Badge>
      ) : (
        <Badge>Entered manually</Badge>
      )}
      {fallbackReason && <span className="text-xs text-amber-700">{fallbackReason}</span>}
    </span>
  );
}
