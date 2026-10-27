import { checkModelEligibility, classifyModel, type LiveProviderId, type ModelClass } from "./eligibility";
import type { JsonMode } from "./chatClient";

/**
 * AI provider switchboard — server-side configuration resolved from
 * environment variables. Anything missing, unsafe or ineligible keeps the app
 * in SIMULATION mode and the reason is reported (never the key) on
 * /api/ai/status.
 *
 * Endpoints below were checked against each provider's official docs
 * (October 2026). Model ids for Groq and OpenRouter are deliberately NOT
 * defaulted: no Meta model is verified as both live and free there — the
 * owner sets them after checking the catalogue (see /api/ai/catalog).
 */
export interface AIEnv {
  AI_MODE?: string;
  // Meta Model API (hosted Muse Spark) — dev.meta.ai/docs/protocols/chat-completions
  META_MODEL_API_KEY?: string;
  META_MODEL_API_BASE_URL?: string;
  META_MODEL_API_MODEL?: string;
  // GroqCloud — console.groq.com/docs/openai
  GROQ_API_KEY?: string;
  GROQ_BASE_URL?: string;
  GROQ_MODEL?: string;
  // OpenRouter — openrouter.ai/docs/quickstart
  OPENROUTER_API_KEY?: string;
  OPENROUTER_BASE_URL?: string;
  OPENROUTER_MODEL?: string;
  OPENROUTER_FREE_ONLY?: string;
  OPENROUTER_APP_URL?: string;
  OPENROUTER_APP_TITLE?: string;
  // Any other approved OpenAI-compatible open-weight host (Fireworks, Baseten, Modal, Together, …)
  OPEN_WEIGHT_BASE_URL?: string;
  OPEN_WEIGHT_API_KEY?: string;
  OPEN_WEIGHT_MODEL?: string;
  OPEN_WEIGHT_HOST_LABEL?: string;
  // Shared tuning & safety
  AI_JSON_MODE?: string;
  AI_TIMEOUT_MS?: string;
  AI_MAX_RETRIES?: string;
  AI_MAX_OUTPUT_TOKENS?: string;
  AI_EXTRA_ALLOWED_MODELS?: string;
  AI_ALLOW_NON_META_DEV_MODEL?: string;
  AI_DAILY_CALL_LIMIT?: string;
  AI_CONNECTION_TEST_TOKEN?: string;
  // Mission 1 names, still accepted
  META_LLAMA_BASE_URL?: string;
  META_LLAMA_API_KEY?: string;
  META_LLAMA_MODEL?: string;
  META_LLAMA_HOST_LABEL?: string;
}

export const META_MODEL_API_DEFAULT_BASE_URL = "https://api.meta.ai/v1";
export const META_MODEL_API_DEFAULT_MODEL = "muse-spark-1.3";
export const GROQ_DEFAULT_BASE_URL = "https://api.groq.com/openai/v1";
export const OPENROUTER_DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";

export interface LiveAIConfig {
  provider: LiveProviderId;
  label: string;
  hostLabel: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Meta Model API / Meta open-weight / non-Meta development stand-in. */
  modelClass?: ModelClass;
  /** Extra non-secret request headers (e.g. OpenRouter app attribution). */
  headers?: Record<string, string>;
  jsonMode: JsonMode;
  timeoutMs: number;
  maxRetries: number;
  maxOutputTokens: number;
}

export interface ResolvedAIConfig {
  mode: "simulation" | LiveProviderId;
  live?: LiveAIConfig;
  /** Why live mode could not start (shown to staff, never contains secrets). */
  issues: string[];
  warnings: string[];
  /** The selected provider even when incomplete — used only server-side for the free catalogue check. */
  candidate?: LiveAIConfig;
}

const MODES = ["simulation", "meta-model-api", "groq", "openrouter", "open-weight"] as const;

function int(v: string | undefined, def: number, min: number, max: number): number {
  const n = v === undefined || v === "" ? def : Number(v);
  return Number.isInteger(n) ? Math.min(max, Math.max(min, n)) : def;
}

function isHttpsUrl(u: string): boolean {
  try {
    const url = new URL(u);
    return url.protocol === "https:" || (url.protocol === "http:" && /^(localhost|127\.0\.0\.1)$/.test(url.hostname));
  } catch {
    return false;
  }
}

function safeHost(u: string): string {
  try {
    return new URL(u).hostname;
  } catch {
    return "";
  }
}

const t = (v: string | undefined) => (v ?? "").trim();

export function resolveAIConfig(env: AIEnv): ResolvedAIConfig {
  const raw = t(env.AI_MODE).toLowerCase() || "simulation";
  // "meta" was the Mission 1 value for an OpenAI-compatible Llama host.
  const mode = raw === "meta" ? "open-weight" : raw;
  const issues: string[] = [];
  const warnings: string[] = [];

  if (mode === "simulation") return { mode: "simulation", issues, warnings };
  if (!(MODES as readonly string[]).includes(mode)) {
    return { mode: "simulation", issues: [`Unknown AI_MODE "${raw}" — use one of: ${MODES.join(", ")}`], warnings };
  }
  const provider = mode as LiveProviderId;

  const shared = {
    jsonMode: (["auto", "response_format", "prompt"].includes(t(env.AI_JSON_MODE)) ? t(env.AI_JSON_MODE) : "auto") as JsonMode,
    timeoutMs: int(env.AI_TIMEOUT_MS, 20_000, 2_000, 120_000),
    maxRetries: int(env.AI_MAX_RETRIES, 1, 0, 3),
    maxOutputTokens: int(env.AI_MAX_OUTPUT_TOKENS, 800, 64, 4_000),
  };
  const extraAllowed = t(env.AI_EXTRA_ALLOWED_MODELS).split(",").map((s) => s.trim()).filter(Boolean);
  const allowDev = t(env.AI_ALLOW_NON_META_DEV_MODEL).toLowerCase() === "true";

  let live: LiveAIConfig;
  switch (provider) {
    case "meta-model-api": {
      const baseUrl = t(env.META_MODEL_API_BASE_URL) || META_MODEL_API_DEFAULT_BASE_URL;
      const model = t(env.META_MODEL_API_MODEL) || META_MODEL_API_DEFAULT_MODEL;
      if (!/(^|\.)meta\.ai$/.test(safeHost(baseUrl))) warnings.push(`META_MODEL_API_BASE_URL points at ${safeHost(baseUrl)}, not Meta's api.meta.ai`);
      if (/contributor/i.test(model)) warnings.push(`"${model}" may allow Meta to use prompts and completions for training — avoid with real guest data`);
      live = { provider, label: "Meta Model API", hostLabel: "Meta", baseUrl, apiKey: t(env.META_MODEL_API_KEY), model, ...shared };
      if (!live.apiKey) issues.push("META_MODEL_API_KEY is not set");
      break;
    }
    case "groq": {
      const baseUrl = t(env.GROQ_BASE_URL) || GROQ_DEFAULT_BASE_URL;
      live = { provider, label: "GroqCloud", hostLabel: "Groq", baseUrl, apiKey: t(env.GROQ_API_KEY), model: t(env.GROQ_MODEL), ...shared };
      if (!live.apiKey) issues.push("GROQ_API_KEY is not set");
      if (!live.model) issues.push("GROQ_MODEL is not set — check the Groq catalogue for a Meta model your account can use (e.g. meta-models/muse-spark-open after preview approval)");
      break;
    }
    case "openrouter": {
      const baseUrl = t(env.OPENROUTER_BASE_URL) || OPENROUTER_DEFAULT_BASE_URL;
      const headers: Record<string, string> = {};
      // Optional app attribution headers documented by OpenRouter; not secrets.
      if (t(env.OPENROUTER_APP_URL)) headers["HTTP-Referer"] = t(env.OPENROUTER_APP_URL);
      if (t(env.OPENROUTER_APP_TITLE)) headers["X-OpenRouter-Title"] = t(env.OPENROUTER_APP_TITLE);
      live = { provider, label: "OpenRouter", hostLabel: "OpenRouter", baseUrl, apiKey: t(env.OPENROUTER_API_KEY), model: t(env.OPENROUTER_MODEL), headers, ...shared };
      if (!live.apiKey) issues.push("OPENROUTER_API_KEY is not set");
      if (!live.model) issues.push("OPENROUTER_MODEL is not set — check the OpenRouter catalogue for a Meta model (\":free\" variants cost nothing)");
      // Free-only by default so a typo can never start a paid model.
      const freeOnly = t(env.OPENROUTER_FREE_ONLY).toLowerCase() !== "false";
      if (live.model && freeOnly && !live.model.endsWith(":free")) {
        issues.push(`OpenRouter model "${live.model}" is not a ":free" variant. Set OPENROUTER_FREE_ONLY=false only after the owner approves paid usage.`);
      }
      if (live.model.endsWith(":free")) warnings.push("OpenRouter free models are rate-limited (published: 20 requests/min, 50/day without purchased credits) — use fictional data only");
      break;
    }
    default: {
      const baseUrl = t(env.OPEN_WEIGHT_BASE_URL) || t(env.META_LLAMA_BASE_URL);
      const hostLabel = t(env.OPEN_WEIGHT_HOST_LABEL) || t(env.META_LLAMA_HOST_LABEL) || safeHost(baseUrl) || "open-weight host";
      live = {
        provider: "open-weight",
        label: `Meta open-weight via ${hostLabel}`,
        hostLabel,
        baseUrl,
        apiKey: t(env.OPEN_WEIGHT_API_KEY) || t(env.META_LLAMA_API_KEY),
        model: t(env.OPEN_WEIGHT_MODEL) || t(env.META_LLAMA_MODEL),
        ...shared,
      };
      if (!baseUrl) issues.push("OPEN_WEIGHT_BASE_URL is not set");
      if (!live.apiKey) issues.push("OPEN_WEIGHT_API_KEY is not set");
      if (env.META_LLAMA_BASE_URL || env.META_LLAMA_MODEL) warnings.push("META_LLAMA_* variables are deprecated — rename to OPEN_WEIGHT_*");
    }
  }

  if (live.baseUrl && !isHttpsUrl(live.baseUrl)) issues.push("Base URL must be a valid https:// URL");

  if (live.model) {
    const cls = classifyModel(live.provider, live.model, extraAllowed);
    live.modelClass = cls.modelClass;
    if (cls.modelClass === "non-meta-dev") {
      // The Meta Model API only serves Meta models, so a dev stand-in makes no sense there.
      if (allowDev && live.provider !== "meta-model-api") {
        warnings.push(`"${live.model}" is NOT a Meta model — running as a labelled development stand-in, not eligible for the hackathon demo`);
        live.label = `${live.label} (non-Meta dev model)`;
      } else {
        issues.push(checkModelEligibility(live.provider, live.model, extraAllowed).reason ?? `"${live.model}" is not a Meta model`);
      }
    } else if (live.provider !== "meta-model-api") {
      live.label = live.provider === "open-weight" ? live.label : `Meta open-weight via ${live.hostLabel}`;
      if (cls.note.includes("confirm")) warnings.push(cls.note);
    }
  } else if (live.provider === "open-weight" || live.provider === "meta-model-api") {
    issues.push("No model id configured");
  }

  return issues.length ? { mode: "simulation", issues, warnings, candidate: live } : { mode: live.provider, live, issues, warnings, candidate: live };
}
