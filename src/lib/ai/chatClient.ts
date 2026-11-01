import { AIProviderError, errorFromStatus } from "./errors";
import { chatWorstUSD, PRICES, reserve, settle, type SpendConfig } from "./spendLedger";

/**
 * Minimal Chat Completions client for OpenAI-compatible endpoints:
 * Meta Model API (https://api.meta.ai/v1, per dev.meta.ai/docs/protocols/chat-completions),
 * GroqCloud (https://api.groq.com/openai/v1), OpenRouter (https://openrouter.ai/api/v1)
 * and other open-weight hosts (Fireworks, Baseten, Modal, Together, …).
 * Only standard fields are sent (no logprobs/logit_bias/n, which Groq rejects).
 *
 * Hardening: request timeout, bounded retries with backoff for 429/5xx/
 * timeouts/network errors, and a JSON-mode fallback because `response_format`
 * support on the hosted Meta API is not yet confirmed in its documentation.
 */
export type JsonMode = "auto" | "response_format" | "prompt";

export interface ChatClientConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  maxRetries: number;
  maxOutputTokens: number;
  jsonMode: JsonMode;
  /**
   * Optional `reasoning_effort` (e.g. "minimal"). Muse Spark is a reasoning model: hidden reasoning
   * tokens count against max_tokens, so a low effort keeps short tasks within budget.
   */
  reasoningEffort?: string;
  /** Optional hard spend cap (approved live runs): checked before every HTTP request. */
  spend?: SpendConfig;
  /** Extra non-secret headers, e.g. OpenRouter app attribution. */
  headers?: Record<string, string>;
  fetchImpl?: typeof fetch;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
}

export interface ChatMessage {
  role: "system" | "user";
  content: string;
}

export interface TokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  /** Hidden reasoning tokens (already included in completionTokens). */
  reasoningTokens?: number;
}

export interface ChatResult {
  content: string;
  id?: string;
  model?: string;
  usage?: TokenUsage;
  latencyMs: number;
  attempts: number;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function chatCompletion(cfg: ChatClientConfig, messages: ChatMessage[], json: boolean): Promise<ChatResult> {
  const sleep = cfg.sleep ?? defaultSleep;
  const started = Date.now();
  let useResponseFormat = json && cfg.jsonMode !== "prompt";
  let minimal = false;
  let attempts = 0;

  for (;;) {
    attempts++;
    try {
      // max_tokens is always sent, also on the minimal retry, so output (and cost) stays capped.
      const body: Record<string, unknown> = { model: cfg.model, messages, temperature: 0.2, max_tokens: cfg.maxOutputTokens };
      if (!minimal && cfg.reasoningEffort) body.reasoning_effort = cfg.reasoningEffort;
      if (useResponseFormat) body.response_format = { type: "json_object" };
      const res = await post(cfg, body);
      return { ...res, latencyMs: Date.now() - started, attempts };
    } catch (e) {
      const err = e instanceof AIProviderError ? e : new AIProviderError("unavailable", `network error: ${(e as Error).message}`);
      // In auto mode, a 400 may mean an unsupported optional parameter: retry once with a minimal body.
      if (err.code === "bad_request" && cfg.jsonMode === "auto" && !minimal) {
        useResponseFormat = false;
        minimal = true;
        continue;
      }
      if (err.retryable && attempts <= cfg.maxRetries) {
        await sleep(Math.min(4000, 500 * 2 ** (attempts - 1)));
        continue;
      }
      throw err;
    }
  }
}

async function post(cfg: ChatClientConfig, body: Record<string, unknown>): Promise<Omit<ChatResult, "latencyMs" | "attempts">> {
  const entry = cfg.spend ? reserve(cfg.spend, "chat", chatWorstUSD(JSON.stringify(body.messages ?? []).length, Number(body.max_tokens) || cfg.maxOutputTokens)) : undefined;
  try {
    const r = await postOnce(cfg, body);
    if (cfg.spend && entry) {
      const u = r.usage;
      const cost = u?.promptTokens !== undefined || u?.completionTokens !== undefined ? (u.promptTokens ?? 0) * PRICES.chatIn + (u.completionTokens ?? 0) * PRICES.chatOut : entry.worstUSD;
      settle(cfg.spend, entry.n, { status: 200, costUSD: cost, responseId: r.id, model: r.model, usage: u });
    }
    return r;
  } catch (e) {
    if (cfg.spend && entry) {
      const status = e instanceof AIProviderError ? e.status : undefined;
      // A rejected request (4xx) is not processed; anything else keeps its worst-case reservation.
      settle(cfg.spend, entry.n, { status, costUSD: status && status < 500 ? 0 : entry.worstUSD, note: (e as Error).message.slice(0, 160) });
    }
    throw e;
  }
}

async function postOnce(cfg: ChatClientConfig, body: Record<string, unknown>): Promise<Omit<ChatResult, "latencyMs" | "attempts">> {
  const doFetch = cfg.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  let res: Response;
  try {
    res = await doFetch(`${cfg.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: { ...cfg.headers, "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    if (controller.signal.aborted || (e as Error).name === "AbortError") {
      throw new AIProviderError("timeout", `no response within ${Math.round(cfg.timeoutMs / 1000)}s`);
    }
    throw new AIProviderError("unavailable", `could not reach the service (${(e as Error).message})`);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw errorFromStatus(res.status, redact(detail, cfg.apiKey));
  }
  let parsed: {
    id?: string;
    model?: string;
    choices?: { message?: { content?: unknown }; finish_reason?: string }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number } };
  };
  try {
    parsed = await res.json();
  } catch {
    throw new AIProviderError("bad_response", "response was not JSON");
  }
  const content = parsed.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    const why = parsed.choices?.[0]?.finish_reason === "length" ? " (output token limit reached, e.g. by hidden reasoning)" : "";
    throw new AIProviderError("bad_response", `response contained no message text${why}`);
  }
  const u = parsed.usage;
  const usage: TokenUsage | undefined = u
    ? { promptTokens: num(u.prompt_tokens), completionTokens: num(u.completion_tokens), reasoningTokens: num(u.completion_tokens_details?.reasoning_tokens) }
    : undefined;
  return { content, id: parsed.id, model: parsed.model, usage };
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** Make sure an echoed key never reaches logs or the UI. */
function redact(text: string, secret: string): string {
  return secret ? text.split(secret).join("[redacted]") : text;
}
