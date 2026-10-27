import { validateExtraction, unitsFromExtraction, type ExtractionCheck } from "../enquiry/extraction";
import type { GuestUnit } from "../domain/types";
import { MetaLlamaProvider } from "./metaLlamaProvider";
import { SimulationProvider } from "./simulationProvider";
import type { AIResult, ConciergeInput, DraftInput, ExplainInput, HospitalityAIProvider, InterpretContext } from "./types";
import { validateConciergeIntent, type ConciergeIntent } from "../maps/concierge";

export interface AIEnv {
  AI_MODE?: string;
  META_LLAMA_BASE_URL?: string;
  META_LLAMA_API_KEY?: string;
  META_LLAMA_MODEL?: string;
  META_LLAMA_HOST_LABEL?: string;
}

export interface ProviderSelection {
  primary: HospitalityAIProvider;
  simulation: SimulationProvider;
  /** Why live Meta mode is not active, when it isn't. */
  configIssue?: string;
}

/** Chooses the provider from server-side environment variables. Defaults to simulation. */
export function selectProvider(env: AIEnv = process.env as AIEnv): ProviderSelection {
  const simulation = new SimulationProvider();
  if ((env.AI_MODE ?? "simulation").toLowerCase() !== "meta") return { primary: simulation, simulation };
  try {
    const primary = new MetaLlamaProvider({
      baseUrl: env.META_LLAMA_BASE_URL ?? "",
      apiKey: env.META_LLAMA_API_KEY ?? "",
      model: env.META_LLAMA_MODEL ?? "",
      hostLabel: env.META_LLAMA_HOST_LABEL,
    });
    return { primary, simulation };
  } catch (e) {
    return { primary: simulation, simulation, configIssue: (e as Error).message };
  }
}

async function withFallback<T>(sel: ProviderSelection, run: (p: HospitalityAIProvider) => Promise<T>): Promise<AIResult<T>> {
  const p = sel.primary;
  try {
    const data = await run(p);
    return { source: p.info.kind, label: p.info.label, model: p.info.model, data, fallbackReason: sel.configIssue };
  } catch (e) {
    if (p === sel.simulation) throw e;
    const data = await run(sel.simulation);
    return {
      source: "simulation",
      label: sel.simulation.info.label,
      data,
      fallbackReason: `Meta model call failed (${(e as Error).message}); simulation used instead`,
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
    return { ...result, source: "simulation", label: sel.simulation.info.label, model: undefined, data: safe, fallbackReason: "AI wording contained figures and was replaced" };
  }
  return result;
}

export async function interpretConcierge(sel: ProviderSelection, input: ConciergeInput): Promise<AIResult<ConciergeIntent>> {
  const result = await withFallback(sel, (p) => p.interpretConciergeQuestion(input));
  return { ...result, data: validateConciergeIntent(result.data, input.categories) };
}
