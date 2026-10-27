import { validateExtraction, unitsFromExtraction, type ExtractionCheck } from "../enquiry/extraction";
import type { GuestUnit } from "../domain/types";
import { MetaAIProvider } from "./metaProvider";
import { SimulationProvider } from "./simulationProvider";
import { resolveAIConfig, type AIEnv, type ResolvedAIConfig } from "./config";
import { describeError } from "./errors";
import { CallBudget, sharedBudget } from "./budget";
import type { AIResult, ConciergeInput, DraftInput, ExplainInput, HospitalityAIProvider, InterpretContext } from "./types";
import { validateConciergeIntent, type ConciergeIntent } from "../maps/concierge";

export type { AIEnv } from "./config";

export interface ProviderSelection {
  primary: HospitalityAIProvider;
  simulation: SimulationProvider;
  config: ResolvedAIConfig;
  /** Why live Meta mode is not active, when it was requested but couldn't start. */
  configIssue?: string;
  /** Daily cap on live (billable) calls. */
  budget?: CallBudget;
}

export interface ProviderDeps {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  budget?: CallBudget;
}

/** Chooses the provider from server-side environment variables. Defaults to simulation. */
export function selectProvider(env: AIEnv = process.env as AIEnv, deps: ProviderDeps = {}): ProviderSelection {
  const simulation = new SimulationProvider();
  const config = resolveAIConfig(env);
  if (!config.live) {
    return { primary: simulation, simulation, config, configIssue: config.issues.length ? `Live Meta AI not started: ${config.issues.join("; ")}` : undefined };
  }
  const limit = Number.parseInt(env.AI_DAILY_CALL_LIMIT ?? "", 10);
  const budget = deps.budget ?? sharedBudget(Number.isInteger(limit) && limit >= 0 ? limit : 200);
  return { primary: new MetaAIProvider(config.live, deps), simulation, config, budget };
}

async function withFallback<T>(sel: ProviderSelection, run: (p: HospitalityAIProvider) => Promise<T>): Promise<AIResult<T>> {
  const p = sel.primary;
  const sim = (): Pick<AIResult<T>, "source" | "provider" | "label"> => ({ source: "simulation", provider: "simulation", label: sel.simulation.info.label });
  if (p === sel.simulation) {
    return { ...sim(), data: await run(p), fallbackReason: sel.configIssue };
  }
  if (sel.budget && !sel.budget.take()) {
    return { ...sim(), data: await run(sel.simulation), fallbackReason: "Daily live-call limit (AI_DAILY_CALL_LIMIT) reached — simulation used instead" };
  }
  try {
    const data = await run(p);
    const call = p instanceof MetaAIProvider ? p.lastCall : undefined;
    return { source: "meta", provider: p.info.id, label: p.info.label, model: call?.servedModel ?? p.info.model, data, call };
  } catch (e) {
    return {
      ...sim(),
      data: await run(sel.simulation),
      fallbackReason: `${p.info.label} call failed (${describeError(e)}) — simulation used instead`,
    };
  }
}

export interface InterpretOutput {
  check: ExtractionCheck;
  units: GuestUnit[];
}

export async function interpretEnquiry(sel: ProviderSelection, text: string, ctx: InterpretContext): Promise<AIResult<InterpretOutput>> {
  if (!text.trim()) throw new Error("Enquiry text is empty");
  const result = await withFallback(sel, (p) => p.interpretEnquiry(text.slice(0, 4000), ctx));
  // Deterministic validation of whatever the model returned.
  const check = validateExtraction(result.data);
  const units = check.missing.includes("number of adults") ? [] : unitsFromExtraction(check.value, check.value.guestName ?? "Guest");
  return { ...result, data: { check, units } };
}

export async function explainOptions(sel: ProviderSelection, input: ExplainInput): Promise<AIResult<string>> {
  return withFallback(sel, (p) => p.explainOptions(input));
}

/** Rejects AI wording that contains figures, so prices can only come from the validated quote. */
export function containsFigures(text: string): boolean {
  return /(\bR\s?\d|ZAR|\$|€|£|\d{2,})/.test(text);
}

export async function draftQuoteIntro(sel: ProviderSelection, input: DraftInput): Promise<AIResult<string>> {
  const result = await withFallback(sel, (p) => p.draftQuoteIntro(input));
  if (containsFigures(result.data)) {
    const safe = await sel.simulation.draftQuoteIntro(input);
    return {
      source: "simulation",
      provider: "simulation",
      label: sel.simulation.info.label,
      data: safe,
      fallbackReason: "AI wording contained figures and was replaced",
    };
  }
  return result;
}

export async function interpretConcierge(sel: ProviderSelection, input: ConciergeInput): Promise<AIResult<ConciergeIntent>> {
  const result = await withFallback(sel, (p) => p.interpretConciergeQuestion(input));
  return { ...result, data: validateConciergeIntent(result.data, input.categories) };
}

/**
 * One tiny live request to prove credentials work. Only ever triggered by an
 * explicit owner action — it is a (very small) billable call.
 */
export async function connectionTest(sel: ProviderSelection): Promise<{ ok: boolean; provider: string; model?: string; detail: string; latencyMs?: number }> {
  if (!(sel.primary instanceof MetaAIProvider)) {
    return { ok: false, provider: "simulation", detail: sel.configIssue ?? "AI_MODE is simulation — no live provider configured" };
  }
  try {
    const out = await sel.primary.draftQuoteIntro({
      guestName: "Test Guest",
      checkIn: "2026-12-01",
      checkOut: "2026-12-02",
      optionTitle: "connection test",
      roomNames: [],
      notes: [],
      propertyName: "Parkside Demo Guest House",
    });
    const call = sel.primary.lastCall;
    return { ok: true, provider: sel.primary.info.label, model: call?.servedModel ?? sel.primary.info.model, detail: out.slice(0, 200), latencyMs: call?.latencyMs };
  } catch (e) {
    return { ok: false, provider: sel.primary.info.label, model: sel.primary.info.model, detail: describeError(e) };
  }
}
