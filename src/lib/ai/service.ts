import { validateExtraction, unitsFromExtraction, headcountMentioned, relativeDatePhrase, type ExtractionCheck } from "../enquiry/extraction";
import type { GuestUnit } from "../domain/types";
import { MetaAIProvider } from "./metaProvider";
import { SimulationProvider } from "./simulationProvider";
import { resolveAIConfig, type AIEnv, type ResolvedAIConfig } from "./config";
import { describeError } from "./errors";
import { CallBudget, sharedBudget } from "./budget";
import type { AIResult, ClarifyInput, ConciergeInput, DraftInput, ExplainInput, HospitalityAIProvider, InterpretContext } from "./types";
import { violatesClarificationRules } from "./clarify";
import { transcribeWav, VOICE_MODEL, type TranscribeOptions } from "./voice";
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
    return { source: p.info.kind, provider: p.info.id, modelClass: p.info.modelClass, label: p.info.label, model: call?.servedModel ?? p.info.model, data, call };
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
  // Deterministic guard: never let an interpretation silently undercount the group in the message.
  const mentioned = headcountMentioned(text);
  const interpreted = (check.value.adults ?? 0) + (check.value.children ?? 0);
  if (mentioned !== undefined && mentioned > interpreted) {
    check.missing.push(`guest count to confirm: the message mentions ${mentioned} people but the interpretation has ${interpreted}`);
  }
  // Deterministic guard: a relative date ("the Friday after next") must be confirmed with the guest.
  const rel = relativeDatePhrase(text);
  if (rel && (check.value.checkIn || check.value.checkOut)) {
    check.missing.push(`dates to confirm with the guest: they wrote "${rel}" (resolved from ${ctx.today})`);
  } else if (rel) {
    check.missing.push(`dates: the guest wrote "${rel}" — ask for exact dates`);
  }
  const units = check.missing.includes("number of adults") ? [] : unitsFromExtraction(check.value, check.value.guestName ?? "Guest");
  return { ...result, data: { check, units } };
}

/** Money wording: currency symbols, amounts or price terms. Guest and room counts are allowed. */
export function containsPriceTalk(text: string): boolean {
  return /(\bR\s?\d|\bZAR\b|\brand\b|\$|€|£|\bper night\b|\bdiscount\b|\bdeposit\b|\bprice[sd]?\b|\bcost[s]?\b|\bcheaper\b|\bfree of charge\b)/i.test(text);
}

export async function explainOptions(sel: ProviderSelection, input: ExplainInput): Promise<AIResult<string>> {
  const result = await withFallback(sel, (p) => p.explainOptions(input));
  if (result.source !== "simulation" && containsPriceTalk(result.data)) {
    // Prices may only come from the validated quote, never from AI wording.
    return {
      source: "simulation",
      provider: "simulation",
      label: sel.simulation.info.label,
      data: await sel.simulation.explainOptions(input),
      fallbackReason: "AI explanation mentioned prices and was replaced",
    };
  }
  return result;
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

/** Drafts a question for the guest when information is missing. The AI may only ask; guarded below. */
export async function draftClarification(sel: ProviderSelection, input: ClarifyInput): Promise<AIResult<string>> {
  const clean: ClarifyInput = { ...input, questions: input.questions.filter((q) => typeof q === "string" && q.trim()).map((q) => q.slice(0, 200)).slice(0, 6) };
  const result = await withFallback(sel, (p) => p.draftClarification(clean));
  const why = result.source !== "simulation" ? violatesClarificationRules(result.data) : undefined;
  if (why) {
    return {
      source: "simulation",
      provider: "simulation",
      label: sel.simulation.info.label,
      data: await sel.simulation.draftClarification(clean),
      fallbackReason: `AI reply ${why} and was replaced`,
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

export interface TranscribeResult {
  ok: boolean;
  /** "meta" only for a genuine Muse Voice Transcribe response. There is no simulated transcription. */
  source: "meta" | "none";
  model?: string;
  transcript?: string;
  audioDurationMs?: number;
  sessionId?: string;
  latencyMs?: number;
  reason?: string;
}

/**
 * Speech-to-text through Meta Muse Voice Transcribe. Only the Meta Model API route offers it.
 * Never simulated: without live Meta mode the result says so and the user types instead.
 */
export async function transcribeSpeech(sel: ProviderSelection, wav: Uint8Array, opts: TranscribeOptions = {}, fetchImpl?: typeof fetch): Promise<TranscribeResult> {
  const live = sel.config.live;
  if (!live || live.provider !== "meta-model-api") {
    return { ok: false, source: "none", reason: sel.configIssue ?? "Voice needs live Meta mode (AI_MODE=meta-model-api). Type the message instead." };
  }
  if (sel.budget && !sel.budget.take()) return { ok: false, source: "none", reason: "Daily live-call limit (AI_DAILY_CALL_LIMIT) reached — type the message instead." };
  try {
    const t = await transcribeWav(live, wav, opts, fetchImpl);
    return { ok: true, source: "meta", model: VOICE_MODEL, ...t };
  } catch (e) {
    return { ok: false, source: "none", reason: `Muse Voice Transcribe failed (${describeError(e)})` };
  }
}
