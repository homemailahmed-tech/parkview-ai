import { chatCompletion, type ChatClientConfig } from "./chatClient";
import type { LiveAIConfig } from "./config";
import { AIProviderError } from "./errors";
import { endpointTrust } from "./endpoint";
import type { ClarifyInput, ConciergeInput, DraftInput, ExplainInput, HospitalityAIProvider, InterpretContext, LiveCallMeta, ProviderInfo } from "./types";

/**
 * Live model provider behind the switchboard, for:
 *  - Meta Model API (hosted Muse Spark, e.g. muse-spark-1.3),
 *  - Meta open-weight models (e.g. Muse Spark Open, Llama) on GroqCloud,
 *    OpenRouter or other OpenAI-compatible hosts, and
 *  - an explicitly enabled NON-Meta development stand-in (labelled as such).
 *
 * Status: the Meta Model API route (muse-spark-1.3) was verified with live calls on 1 Nov 2026
 * (see docs/LIVE_META_VERIFICATION.md); other hosts are tested with mocked HTTP only.
 */
export class MetaAIProvider implements HospitalityAIProvider {
  readonly info: ProviderInfo;
  private readonly client: ChatClientConfig;
  /** Metadata about the most recent successful live call. */
  lastCall?: LiveCallMeta;

  constructor(cfg: LiveAIConfig, deps: { fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> } = {}) {
    const modelClass = cfg.modelClass ?? (cfg.provider === "meta-model-api" ? "meta-model-api" : "meta-open-weight");
    // Labels follow where requests really go: a local or non-Meta endpoint is a TEST endpoint, never "Live Meta AI".
    const trust = endpointTrust(cfg.baseUrl);
    const isTest = trust === "local" || (cfg.provider === "meta-model-api" && trust !== "meta-official");
    this.info = isTest
      ? { kind: "test", id: cfg.provider, label: `LOCAL TEST endpoint (${safeHost(cfg.baseUrl)})`, model: cfg.model, host: safeHost(cfg.baseUrl), modelClass }
      : { kind: modelClass === "non-meta-dev" ? "dev-model" : "meta", id: cfg.provider, label: cfg.label, model: cfg.model, host: cfg.hostLabel, modelClass };
    this.client = {
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey,
      model: cfg.model,
      timeoutMs: cfg.timeoutMs,
      maxRetries: cfg.maxRetries,
      maxOutputTokens: cfg.maxOutputTokens,
      jsonMode: cfg.jsonMode,
      reasoningEffort: cfg.reasoningEffort,
      spend: cfg.spend,
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
    this.lastCall = { responseId: r.id, servedModel: r.model, usage: r.usage, latencyMs: r.latencyMs, attempts: r.attempts };
    return r.content;
  }

  async interpretEnquiry(text: string, ctx: InterpretContext): Promise<unknown> {
    const system = [
      `You extract booking details from guest messages for ${ctx.propertyName}. Today is ${ctx.today} (${weekday(ctx.today)}).`,
      "Messages are informal WhatsApp text and may mix languages (for example English, isiZulu, Afrikaans). Understand them in any language.",
      "If the guest corrects themselves, the LATER statement wins. Resolve relative dates (e.g. 'the Friday after next') from today's date.",
      "Count everyone: players, learners, members, coaches, teachers, drivers, leaders and family members (e.g. a grandmother) all count.",
      "Reply with ONE JSON object only (no prose), using these optional keys:",
      "guestName (string), checkIn (YYYY-MM-DD), checkOut (YYYY-MM-DD), nights (int),",
      "adults (int, the TOTAL number of adults in the whole group, including players, members, drivers, coaches and leaders), children (int),",
      "couples (int, couples NOT inside a family who share a bed), families (array of {adults:int, children:int}),",
      "drivers (int, need own room), groupLeaders (int, need own room), wheelchairUsers (int), groundFloorGuests (int),",
      "separateBeds (bool), selfCatering (bool), notes (array of short strings, in English),",
      "clarifications (array of short English questions staff must ask because something is missing, uncertain or contradictory, e.g. 'Two nights or three?').",
      "Omit anything the guest did not state. Never invent dates or numbers: if unsure, leave the field out and add a clarification. Do not quote prices or promise availability.",
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

  async draftClarification(input: ClarifyInput): Promise<string> {
    const system = [
      `You write a short WhatsApp reply from ${input.propertyName} to a guest whose booking enquiry is incomplete.`,
      "Reply in the same language the guest used (English if unsure), warm and brief (at most 6 short lines).",
      "Ask ONLY the questions listed in the input, rephrased politely for the guest. Do not add other questions.",
      "Do NOT mention prices, totals, discounts or deposits. Do NOT say rooms are available, reserved or confirmed. Do NOT promise anything.",
      "Plain text only, no markdown headings.",
    ].join("\n");
    const user = JSON.stringify({ guestName: input.guestName, questions: input.questions, guestMessage: input.guestMessage.slice(0, 1500) });
    return (await this.chat(system, user, false)).trim();
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

function safeHost(u: string): string {
  try {
    return new URL(u).host;
  } catch {
    return "unknown host";
  }
}

function weekday(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
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
