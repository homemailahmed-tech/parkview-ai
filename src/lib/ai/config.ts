import { checkModelEligibility, type MetaProviderId } from "./eligibility";
import type { JsonMode } from "./chatClient";

/**
 * Server-side AI configuration, resolved from environment variables.
 * Anything missing or ineligible keeps the app in SIMULATION mode and the
 * reason is reported (without secrets) on /api/ai/status.
 */
export interface AIEnv {
  AI_MODE?: string;
  // Meta Model API (hosted Muse Spark)
  META_MODEL_API_KEY?: string;
  META_MODEL_API_BASE_URL?: string;
  META_MODEL_API_MODEL?: string;
  // Approved open-weight host (OpenAI-compatible)
  OPEN_WEIGHT_BASE_URL?: string;
  OPEN_WEIGHT_API_KEY?: string;
  OPEN_WEIGHT_MODEL?: string;
  OPEN_WEIGHT_HOST_LABEL?: string;
  // Shared tuning
  AI_JSON_MODE?: string;
  AI_TIMEOUT_MS?: string;
  AI_MAX_RETRIES?: string;
  AI_MAX_OUTPUT_TOKENS?: string;
  AI_EXTRA_ALLOWED_MODELS?: string;
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

export interface LiveAIConfig {
  provider: MetaProviderId;
  label: string;
  hostLabel: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  jsonMode: JsonMode;
  timeoutMs: number;
  maxRetries: number;
  maxOutputTokens: number;
}

export interface ResolvedAIConfig {
  mode: "simulation" | MetaProviderId;
  live?: LiveAIConfig;
  /** Why live mode could not start (shown to staff, never contains secrets). */
  issues: string[];
  warnings: string[];
}

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

export function resolveAIConfig(env: AIEnv): ResolvedAIConfig {
  const raw = (env.AI_MODE ?? "simulation").trim().toLowerCase();
  // "meta" was the Mission 1 value for an OpenAI-compatible Llama host.
  const mode = raw === "meta" ? "open-weight" : raw;
  const issues: string[] = [];
  const warnings: string[] = [];

  if (mode === "simulation" || mode === "") return { mode: "simulation", issues, warnings };
  if (mode !== "meta-model-api" && mode !== "open-weight") {
    return { mode: "simulation", issues: [`Unknown AI_MODE "${raw}" — use simulation, meta-model-api or open-weight`], warnings };
  }

  const shared = {
    jsonMode: (["auto", "response_format", "prompt"].includes(env.AI_JSON_MODE ?? "") ? env.AI_JSON_MODE : "auto") as JsonMode,
    timeoutMs: int(env.AI_TIMEOUT_MS, 20_000, 2_000, 120_000),
    maxRetries: int(env.AI_MAX_RETRIES, 1, 0, 3),
    maxOutputTokens: int(env.AI_MAX_OUTPUT_TOKENS, 800, 64, 4_000),
  };
  const extraAllowed = (env.AI_EXTRA_ALLOWED_MODELS ?? "").split(",").map((s) => s.trim()).filter(Boolean);

  let live: LiveAIConfig;
  if (mode === "meta-model-api") {
    const baseUrl = (env.META_MODEL_API_BASE_URL || META_MODEL_API_DEFAULT_BASE_URL).trim();
    const model = (env.META_MODEL_API_MODEL || META_MODEL_API_DEFAULT_MODEL).trim();
    if (!/(^|\.)meta\.ai$/.test(safeHost(baseUrl))) warnings.push(`META_MODEL_API_BASE_URL points at ${safeHost(baseUrl)}, not Meta's api.meta.ai`);
    if (/contributor/i.test(model)) warnings.push(`"${model}" may allow Meta to use prompts and completions for training — avoid with real guest data`);
    live = { provider: mode, label: "Meta Model API", hostLabel: "Meta", baseUrl, apiKey: (env.META_MODEL_API_KEY ?? "").trim(), model, ...shared };
    if (!live.apiKey) issues.push("META_MODEL_API_KEY is not set");
  } else {
    const baseUrl = (env.OPEN_WEIGHT_BASE_URL || env.META_LLAMA_BASE_URL || "").trim();
    const hostLabel = (env.OPEN_WEIGHT_HOST_LABEL || env.META_LLAMA_HOST_LABEL || safeHost(baseUrl) || "open-weight host").trim();
    live = {
      provider: "open-weight",
      label: `Meta open-weight via ${hostLabel}`,
      hostLabel,
      baseUrl,
      apiKey: (env.OPEN_WEIGHT_API_KEY || env.META_LLAMA_API_KEY || "").trim(),
      model: (env.OPEN_WEIGHT_MODEL || env.META_LLAMA_MODEL || "").trim(),
      ...shared,
    };
    if (!baseUrl) issues.push("OPEN_WEIGHT_BASE_URL is not set");
    if (!live.apiKey) issues.push("OPEN_WEIGHT_API_KEY is not set");
    if (env.META_LLAMA_BASE_URL || env.META_LLAMA_MODEL) warnings.push("META_LLAMA_* variables are deprecated — rename to OPEN_WEIGHT_*");
  }

  if (live.baseUrl && !isHttpsUrl(live.baseUrl)) issues.push("Base URL must be a valid https:// URL");
  const elig = checkModelEligibility(live.provider, live.model, extraAllowed);
  if (!elig.eligible) issues.push(elig.reason!);

  return issues.length ? { mode: "simulation", issues, warnings } : { mode: live.provider, live, issues, warnings };
}

function safeHost(u: string): string {
  try {
    return new URL(u).hostname;
  } catch {
    return "";
  }
}
