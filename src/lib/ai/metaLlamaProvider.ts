import type { ConciergeInput, DraftInput, ExplainInput, HospitalityAIProvider, InterpretContext, ProviderInfo } from "./types";

/**
 * Meta Llama provider over an OpenAI-compatible Chat Completions API.
 *
 * This shape is offered by Meta's Llama API and by approved open-weight hosts
 * (e.g. Fireworks, Together, Baseten, Modal deployments of vLLM). It has NOT
 * been tested against a live endpoint yet — no credentials are available.
 */
export interface MetaLlamaConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  hostLabel?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/** Only Meta Llama-family models are eligible for the hackathon. */
export function isEligibleMetaModel(model: string): boolean {
  const m = model.toLowerCase();
  if (/(claude|gpt|gemini|mistral|qwen|deepseek)/.test(m)) return false;
  return /llama/.test(m);
}

export class MetaLlamaProvider implements HospitalityAIProvider {
  readonly info: ProviderInfo;
  private readonly cfg: MetaLlamaConfig;

  constructor(cfg: MetaLlamaConfig) {
    if (!cfg.baseUrl || !cfg.apiKey || !cfg.model) throw new Error("Meta Llama provider needs base URL, API key and model");
    if (!isEligibleMetaModel(cfg.model)) throw new Error(`Model "${cfg.model}" is not a Meta Llama model`);
    this.cfg = cfg;
    this.info = { kind: "meta", label: `Meta Llama via ${cfg.hostLabel ?? "OpenAI-compatible host"}`, model: cfg.model, verified: false };
  }

  private async chat(system: string, user: string, json: boolean): Promise<string> {
    const doFetch = this.cfg.fetchImpl ?? fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs ?? 20_000);
    try {
      const res = await doFetch(`${this.cfg.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.cfg.apiKey}` },
        body: JSON.stringify({
          model: this.cfg.model,
          temperature: 0.2,
          max_tokens: 800,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          ...(json ? { response_format: { type: "json_object" } } : {}),
        }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Meta model request failed with HTTP ${res.status}`);
      const body = (await res.json()) as { choices?: { message?: { content?: unknown } }[] };
      const content = body.choices?.[0]?.message?.content;
      if (typeof content !== "string" || !content.trim()) throw new Error("Meta model returned an empty response");
      this.info.verified = true;
      return content;
    } finally {
      clearTimeout(timer);
    }
  }

  async interpretEnquiry(text: string, ctx: InterpretContext): Promise<unknown> {
    const system = [
      `You extract booking details from guest messages for ${ctx.propertyName}. Today is ${ctx.today}.`,
      "Reply with ONE JSON object only, using these optional keys:",
      'guestName (string), checkIn (YYYY-MM-DD), checkOut (YYYY-MM-DD), nights (int), adults (int), children (int),',
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
      "You map a hotel guest's local-area question to search intent. Reply with ONE JSON object:",
      `{"categories": string[] (choose only from: ${input.categories.join(", ")}), "withChildren": bool, "keywords": string[], "summary": string}`,
      "Never state distances, travel times, opening hours or Halaal certification.",
    ].join("\n");
    return parseJsonObject(await this.chat(system, input.question, true));
  }
}

/** Extracts the first JSON object from model output (tolerates code fences). */
export function parseJsonObject(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Model response did not contain a JSON object");
  return JSON.parse(cleaned.slice(start, end + 1));
}
