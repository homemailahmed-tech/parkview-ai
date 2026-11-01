import fs from "node:fs";
import { AIProviderError } from "./errors";

/**
 * Optional hard spend cap for approved live runs, enforced inside the app before EVERY HTTP
 * request to a model (chat and voice). The ledger is a JSON file, so the cap survives server
 * restarts and is shared by all API routes. Enabled by AI_SPEND_LEDGER (file path) with
 * AI_SPEND_MAX_CALLS and AI_SPEND_MAX_USD. The key is never written to it.
 */
export interface SpendConfig {
  file: string;
  maxCalls: number;
  maxUSD: number;
}

/** Reported prices (USD): Muse Spark per token; Muse Voice Transcribe per millisecond of audio ($0.18/hour). */
export const PRICES = { chatIn: 1.25e-6, chatOut: 4.25e-6, audioPerMs: 0.18 / 3_600_000 };

export interface LedgerEntry {
  n: number;
  kind: "chat" | "voice";
  at: string;
  worstUSD: number;
  costUSD?: number;
  status?: number;
  responseId?: string;
  model?: string;
  usage?: unknown;
  audioDurationMs?: number;
  note?: string;
}

interface Ledger { calls: LedgerEntry[] }

function load(file: string): Ledger {
  try {
    const l = JSON.parse(fs.readFileSync(file, "utf8")) as Ledger;
    return Array.isArray(l.calls) ? l : { calls: [] };
  } catch {
    return { calls: [] };
  }
}

export function spentUSD(l: Ledger): number {
  return l.calls.reduce((s, c) => s + (c.costUSD ?? c.worstUSD), 0);
}

/** Reserves one call at its worst-case cost, or throws without any request being made. */
export function reserve(cfg: SpendConfig, kind: LedgerEntry["kind"], worstUSD: number): LedgerEntry {
  const l = load(cfg.file);
  if (l.calls.length >= cfg.maxCalls) throw new AIProviderError("budget", `local spend cap reached: ${cfg.maxCalls} calls used`);
  if (spentUSD(l) + worstUSD > cfg.maxUSD) throw new AIProviderError("budget", `local spend cap reached: US$${cfg.maxUSD} would be exceeded`);
  const entry: LedgerEntry = { n: l.calls.length + 1, kind, at: new Date().toISOString(), worstUSD };
  l.calls.push(entry);
  fs.writeFileSync(cfg.file, JSON.stringify(l, null, 2));
  return entry;
}

/** Records the outcome of a reserved call (actual cost when the response reports it). */
export function settle(cfg: SpendConfig, n: number, patch: Partial<LedgerEntry>): void {
  const l = load(cfg.file);
  const e = l.calls.find((c) => c.n === n);
  if (!e) return;
  Object.assign(e, patch);
  fs.writeFileSync(cfg.file, JSON.stringify(l, null, 2));
}

export function chatWorstUSD(promptChars: number, maxTokens: number): number {
  return Math.ceil(promptChars / 2.5) * PRICES.chatIn + maxTokens * PRICES.chatOut;
}
