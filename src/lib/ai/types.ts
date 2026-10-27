import type { AllocationOption, ISODate } from "../domain/types";

/**
 * Provider abstraction for the language model layer.
 *
 * The model is used ONLY for language tasks: understanding enquiries,
 * explaining options and drafting friendly wording. Prices, capacities,
 * availability and booking decisions always come from deterministic code.
 */
export type ProviderKind = "simulation" | "meta";

export interface ProviderInfo {
  kind: ProviderKind;
  /** e.g. "Simulation (rule-based, not AI)" or "Meta Llama via Fireworks". */
  label: string;
  model?: string;
  /** True only after a live call has actually succeeded in this process. */
  verified?: boolean;
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
}

export interface AIResult<T> {
  source: ProviderKind;
  label: string;
  model?: string;
  data: T;
  /** Set when a live Meta call failed and the simulator answered instead. */
  fallbackReason?: string;
}
