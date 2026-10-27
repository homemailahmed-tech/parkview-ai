import { chatCompletion, type ChatClientConfig } from "./chatClient";
import type { LiveAIConfig } from "./config";
import { AIProviderError } from "./errors";
import type { ConciergeInput, DraftInput, ExplainInput, HospitalityAIProvider, InterpretContext, LiveCallMeta, ProviderInfo } from "./types";

/**
 * Live model provider behind the switchboard, for:
 *  - Meta Model API (hosted Muse Spark, e.g. muse-spark-1.3),
 *  - Meta open-weight models (e.g. Muse Spark Open, Llama) on GroqCloud,
 *    OpenRouter or other OpenAI-compatible hosts, and
 *  - an explicitly enabled NON-Meta development stand-in (labelled as such).
 *
 * Status: tested with mocked HTTP only — no live credentials yet.
 */
export class MetaAIProvider implements HospitalityAIProvider {
  readonly info: ProviderInfo;
  private readonly client: ChatClientConfig;
  /** Metadata about the most recent successful live call. */
  lastCall?: LiveCallMeta;

  constructor(cfg: LiveAIConfig, deps: { fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> } = {}) {
    const modelClass = cfg.modelClass ?? (cfg.provider === "meta-model-api" ? "meta-model-api" : "meta-open-weight");
    this.info = { kind: modelClass === "non-meta-dev" ? "dev-model" : "meta", id: cfg.provider, label: cfg.label, model: cfg.model, host: cfg.hostLabel, modelClass };
    this.client = {
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey,
      model: cfg.model,
      timeoutMs: cfg.timeoutMs,
      maxRetries: cfg.maxRetries,
      maxOutputTokens: cfg.maxOutputTokens,
      jsonMode: cfg.jsonMode,
      headers: cfg.headers,
      fetchImpl: deps.fetchImpl,
      sleep: deps.sleep,
    };
  }

  private async chat(system: string, user: string, json: boolean): Promise<string> {
    const r = await chatCompletion(
      this.client,
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      json,
    );
    this.lastCall = { responseId: r.id, servedModel: r.model, latencyMs: r.latencyMs, attempts: r.attempts };
    return r.content;
  }

  async interpretEnquiry(text: string, ctx: InterpretContext): Promise<unknown> {
    const system = [
      `You extract booking details from guest messages for ${ctx.propertyName}. Today is ${ctx.today}.`,
      "Reply with ONE JSON object only (no prose), using these optional keys:",
      "guestName (string), checkIn (YYYY-MM-DD), checkOut (YYYY-MM-DD), nights (int), adults (int), children (int),",
      "couples (int, couples NOT inside a family who share a bed), families (array of {adults:int, children:int}),",
      "drivers (int, need own room), groupLeaders (int, need own room), wheelchairUsers (int), groundFloorGuests (int),",
      "separateBeds (bool), selfCatering (bool), notes (array of short strings).",
      "Omit anything the guest did not state. Never invent dates or numbers. Do not quote prices.",
    ].join("\n");
    return parseJsonObject(await this.chat(system, text, true));
  }

  async explainOptions(input: ExplainInput): Promise<string> {
    const facts = input.options.map((o) => ({
      title: o.title,
      rooms: o.assignments.map((a) => ({ room: input.roomNames[a.roomId], guests: a.guests, beds: a.sleeping })),
      compromises: o.compromises,
    }));
    const system =
      "You explain room-allocation options to a guest-house owner in 3-5 short sentences. Use only the facts given. " +
      "Do not mention or change any prices, capacities or availability — those are shown separately.";
    return (await this.chat(system, JSON.stringify({ guest: input.guestName, options: facts, comparison: input.comparison }), false)).trim();
  }

  async draftQuoteIntro(input: DraftInput): Promise<string> {
    const system =
      "Write a warm 2-3 sentence greeting for a guest-house quotation sent on WhatsApp. " +
      "Do NOT include any prices, totals, dates, room counts or promises — the validated quotation follows your text.";
    return (await this.chat(system, JSON.stringify(input), false)).trim();
  }

  async interpretConciergeQuestion(input: ConciergeInput): Promise<unknown> {
    const system = [
      "You map a hotel guest's local-area question to search intent. Reply with ONE JSON object only:",
      `{"categories": string[] (choose only from: ${input.categories.join(", ")}), "withChildren": bool, "keywords": string[], "summary": string}`,
      "Never state distances, travel times, opening hours or Halaal certification.",
    ].join("\n");
    return parseJsonObject(await this.chat(system, input.question, true));
  }
}

/** Extracts the first JSON object from model output (tolerates code fences and surrounding prose). */
export function parseJsonObject(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new AIProviderError("bad_response", "model reply did not contain a JSON object");
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    throw new AIProviderError("bad_response", "model reply contained malformed JSON");
  }
}
