/**
 * Model classification for the hackathon.
 *
 * - "meta-model-api":   a Meta model served by Meta's own Meta Model API (e.g. Muse Spark).
 * - "meta-open-weight": a Meta open-weight model (e.g. Muse Spark Open, Llama) on another host.
 * - "non-meta-dev":     any other model. Usable ONLY as an explicitly enabled development
 *                       stand-in, always labelled "not Meta AI · not hackathon-eligible".
 */
export type LiveProviderId = "meta-model-api" | "groq" | "openrouter" | "open-weight";
/** @deprecated kept for Mission 2 callers */
export type MetaProviderId = LiveProviderId;

export type ModelClass = "meta-model-api" | "meta-open-weight" | "non-meta-dev";

const NON_META = /(claude|anthropic|gpt|openai\/|o1-|o3-|gemini|gemma|mistral|mixtral|qwen|deepseek|grok|command-r|cohere|phi-|yi-|kimi|glm|nemotron)/i;
const META_HOSTED = /muse[-_ ]?spark(?![-_ ]?open)/i;
const META_OPEN_WEIGHT = /(muse[-_ ]?spark[-_ ]?open|llama)/i;
/** Llama Guard is a safety classifier, not a chat model for this app. */
const NOT_A_CHAT_MODEL = /llama[-_ ]?guard|prompt[-_ ]?guard/i;

export interface Classification {
  modelClass: ModelClass;
  /** Short human explanation shown in the UI and status endpoint. */
  note: string;
}

export function classifyModel(provider: LiveProviderId, model: string, extraAllowedMeta: string[] = []): Classification {
  const m = model.trim();
  const listed = extraAllowedMeta.some((a) => a.trim() && a.trim() === m);
  if (!m || NON_META.test(m) || NOT_A_CHAT_MODEL.test(m) || (!listed && !META_OPEN_WEIGHT.test(m) && !META_HOSTED.test(m))) {
    return { modelClass: "non-meta-dev", note: "Not a Meta model — development use only, not hackathon-eligible" };
  }
  if (provider === "meta-model-api") return { modelClass: "meta-model-api", note: "Meta model via the official Meta Model API" };
  if (META_HOSTED.test(m) && !listed) {
    return { modelClass: "meta-open-weight", note: "Meta Muse Spark via a third-party router — confirm eligibility with the organisers" };
  }
  return { modelClass: "meta-open-weight", note: "Meta open-weight model on a third-party host" };
}

export interface EligibilityResult {
  eligible: boolean;
  reason?: string;
}

/** Whether a model may run as *Meta AI* (non-Meta models are never eligible, even if allow-listed). */
export function checkModelEligibility(provider: LiveProviderId, model: string, extraAllowed: string[] = []): EligibilityResult {
  const m = model.trim();
  if (!m) return { eligible: false, reason: "No model id configured" };
  if (NON_META.test(m)) return { eligible: false, reason: `"${m}" is not a Meta model` };
  if (NOT_A_CHAT_MODEL.test(m)) return { eligible: false, reason: `"${m}" is a safety classifier, not a chat model` };
  if (classifyModel(provider, m, extraAllowed).modelClass !== "non-meta-dev") return { eligible: true };
  return {
    eligible: false,
    reason:
      provider === "meta-model-api"
        ? `"${m}" is not a recognised Meta Model API model (expected e.g. muse-spark-1.3). Add it to AI_EXTRA_ALLOWED_MODELS if Meta lists it.`
        : `"${m}" is not a recognised Meta model. Add the exact id to AI_EXTRA_ALLOWED_MODELS if your host names a Meta model differently.`,
  };
}
