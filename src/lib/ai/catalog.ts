import type { LiveAIConfig } from "./config";
import { classifyModel } from "./eligibility";
import { errorFromStatus, AIProviderError, describeError } from "./errors";

/**
 * Reads a provider's model list (GET {base}/models). This uses no tokens and
 * makes no model call, so it costs nothing — it answers "which Meta models can
 * this account actually use right now, and are they free?" without guessing.
 */
export interface CatalogEntry {
  id: string;
  modelClass: "meta-model-api" | "meta-open-weight" | "non-meta-dev";
  /** true/false when the provider publishes pricing (OpenRouter); undefined otherwise. */
  free?: boolean;
}

export interface CatalogReport {
  ok: boolean;
  provider: string;
  configuredModel: string;
  configuredModelListed?: boolean;
  metaModels: CatalogEntry[];
  totalModels: number;
  detail?: string;
}

interface ModelsResponse {
  data?: { id?: unknown; pricing?: { prompt?: unknown; completion?: unknown }; active?: unknown }[];
}

const isZero = (v: unknown) => v !== undefined && Number(v) === 0;

export async function fetchCatalog(cfg: LiveAIConfig, fetchImpl: typeof fetch = fetch, timeoutMs = 10_000): Promise<CatalogReport> {
  const base = { provider: cfg.label, configuredModel: cfg.model, metaModels: [], totalModels: 0 };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${cfg.baseUrl.replace(/\/+$/, "")}/models`, {
      headers: { ...cfg.headers, Authorization: `Bearer ${cfg.apiKey}` },
      signal: controller.signal,
    });
    if (!res.ok) throw errorFromStatus(res.status);
    const body = (await res.json().catch(() => ({}))) as ModelsResponse;
    if (!Array.isArray(body.data)) throw new AIProviderError("bad_response", "model list not in the expected format");
    const entries = body.data
      .filter((m) => typeof m.id === "string" && m.active !== false)
      .map((m): CatalogEntry => {
        const id = m.id as string;
        const free = m.pricing ? isZero(m.pricing.prompt) && isZero(m.pricing.completion) : undefined;
        return { id, modelClass: classifyModel(cfg.provider, id).modelClass, ...(free === undefined ? {} : { free }) };
      });
    const metaModels = entries.filter((e) => e.modelClass !== "non-meta-dev").sort((a, b) => Number(b.free ?? 0) - Number(a.free ?? 0) || a.id.localeCompare(b.id));
    return {
      ...base,
      ok: true,
      metaModels,
      totalModels: entries.length,
      configuredModelListed: cfg.model ? entries.some((e) => e.id === cfg.model) : undefined,
    };
  } catch (e) {
    const detail = controller.signal.aborted ? "model list request timed out" : describeError(e);
    return { ...base, ok: false, detail };
  } finally {
    clearTimeout(timer);
  }
}
