import { AIProviderError, errorFromStatus } from "./errors";

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

export interface ChatResult {
  content: string;
  id?: string;
  model?: string;
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
      const body: Record<string, unknown> = { model: cfg.model, messages, temperature: 0.2 };
      if (!minimal) body.max_tokens = cfg.maxOutputTokens;
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
  let parsed: { id?: string; model?: string; choices?: { message?: { content?: unknown } }[] };
  try {
    parsed = await res.json();
  } catch {
    throw new AIProviderError("bad_response", "response was not JSON");
  }
  const content = parsed.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw new AIProviderError("bad_response", "response contained no message text");
  return { content, id: parsed.id, model: parsed.model };
}

/** Make sure an echoed key never reaches logs or the UI. */
function redact(text: string, secret: string): string {
  return secret ? text.split(secret).join("[redacted]") : text;
}
