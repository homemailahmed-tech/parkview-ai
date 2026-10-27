/**
 * Hackathon model eligibility. The language layer must run on an eligible
 * Meta model: a Meta Model API model (e.g. Muse Spark) or a Meta open-weight
 * model (e.g. Muse Spark Open, Llama) served by an approved host.
 *
 * Non-Meta model families are always refused so another vendor's model can
 * never stand in for Meta AI in the demo.
 */
export type MetaProviderId = "meta-model-api" | "open-weight";

const NON_META = /(claude|anthropic|gpt|openai|o1-|o3-|gemini|gemma|mistral|mixtral|qwen|deepseek|grok|command-r|cohere|phi-|yi-|kimi|glm)/i;

/** Meta open-weight families. Muse Spark Open and Llama are covered by default. */
const META_OPEN_WEIGHT = /(muse[-_ ]?spark[-_ ]?open|llama)/i;

export interface EligibilityResult {
  eligible: boolean;
  reason?: string;
}

export function checkModelEligibility(provider: MetaProviderId, model: string, extraAllowed: string[] = []): EligibilityResult {
  const m = model.trim();
  if (!m) return { eligible: false, reason: "No model id configured" };
  if (NON_META.test(m)) return { eligible: false, reason: `"${m}" is not a Meta model` };
  if (extraAllowed.some((a) => a.trim() && a.trim() === m)) return { eligible: true };
  if (provider === "meta-model-api") {
    // Every model served by Meta's own API is a Meta model; still require a recognisable family.
    return /muse|llama/i.test(m)
      ? { eligible: true }
      : { eligible: false, reason: `"${m}" is not a recognised Meta Model API model (expected e.g. muse-spark-1.3). Add it to AI_EXTRA_ALLOWED_MODELS if Meta lists it.` };
  }
  return META_OPEN_WEIGHT.test(m)
    ? { eligible: true }
    : { eligible: false, reason: `"${m}" is not a recognised Meta open-weight model. Add the exact id to AI_EXTRA_ALLOWED_MODELS if your host names it differently.` };
}
