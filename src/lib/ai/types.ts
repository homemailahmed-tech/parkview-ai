import type { AllocationOption, ISODate } from "../domain/types";

/**
 * Provider abstraction for the language model layer.
 *
 * The model is used ONLY for language tasks: understanding enquiries,
 * explaining options and drafting friendly wording. Prices, capacities,
 * availability and booking decisions always come from deterministic code.
 */
/**
 * "meta"      — a live response from an eligible Meta model.
 * "dev-model" — a live response from a NON-Meta development stand-in (never shown as Meta AI).
 * "simulation" — rule-based, no model at all.
 */
export type ProviderKind = "simulation" | "meta" | "dev-model";
export type ProviderId = "simulation" | "meta-model-api" | "groq" | "openrouter" | "open-weight";

export interface ProviderInfo {
  kind: ProviderKind;
  id: ProviderId;
  /** e.g. "Simulation mode (rule-based, not AI)", "Meta Model API" or "Meta open-weight via Fireworks". */
  label: string;
  model?: string;
  host?: string;
  modelClass?: "meta-model-api" | "meta-open-weight" | "non-meta-dev";
}

/** Evidence that a response really came from a live Meta model call. */
export interface LiveCallMeta {
  responseId?: string;
  /** Model name reported by the server, if any. */
  servedModel?: string;
  /** Token counts reported by the server, if any (used for cost tracking). */
  usage?: { promptTokens?: number; completionTokens?: number; reasoningTokens?: number };
  latencyMs: number;
  attempts: number;
}

export interface InterpretContext {
  today: ISODate;
  propertyName: string;
}

export interface ExplainInput {
  guestName: string;
  options: AllocationOption[];
  comparison: string;
  roomNames: Record<string, string>;
}

export interface DraftInput {
  guestName: string;
  checkIn: ISODate;
  checkOut: ISODate;
  optionTitle: string;
  roomNames: string[];
  notes: string[];
  propertyName: string;
}

export interface ClarifyInput {
  guestName: string;
  propertyName: string;
  /** What staff still need to know (from deterministic validation and the interpreter). */
  questions: string[];
  /** The guest's own message, so the reply can match their language and tone. */
  guestMessage: string;
}

export interface ConciergeInput {
  question: string;
  categories: string[];
}

export interface HospitalityAIProvider {
  readonly info: ProviderInfo;
  /** Returns raw JSON matching ExtractedEnquiry — validated by the caller. */
  interpretEnquiry(text: string, ctx: InterpretContext): Promise<unknown>;
  /** Plain-language explanation of the allocation options. */
  explainOptions(input: ExplainInput): Promise<string>;
  /** A short personalised greeting paragraph. Must not contain prices. */
  draftQuoteIntro(input: DraftInput): Promise<string>;
  /** Returns raw JSON matching ConciergeIntent — validated by the caller. */
  interpretConciergeQuestion(input: ConciergeInput): Promise<unknown>;
  /** A WhatsApp reply asking the guest ONLY the given questions. No prices, availability or promises. */
  draftClarification(input: ClarifyInput): Promise<string>;
}

export interface AIResult<T> {
  /** "meta" ONLY when this exact response came from a successful live call to an eligible Meta model. */
  source: ProviderKind;
  provider: ProviderId;
  modelClass?: "meta-model-api" | "meta-open-weight" | "non-meta-dev";
  label: string;
  model?: string;
  data: T;
  /** Present only for live Meta responses. */
  call?: LiveCallMeta;
  /** Set when a live Meta call failed (or was not configured) and the simulator answered instead. */
  fallbackReason?: string;
}
