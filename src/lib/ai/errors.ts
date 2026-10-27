export type AIErrorCode =
  | "auth" // 401 / 403 — invalid or unauthorised key
  | "rate_limited" // 429
  | "timeout"
  | "unavailable" // 5xx or network failure
  | "bad_request" // 400 / 404 / 422 — request rejected
  | "bad_response"; // response not in the expected shape

export class AIProviderError extends Error {
  constructor(
    readonly code: AIErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "AIProviderError";
  }

  /** Worth retrying: the same request may succeed a moment later. */
  get retryable(): boolean {
    return this.code === "rate_limited" || this.code === "timeout" || this.code === "unavailable";
  }
}

export function errorFromStatus(status: number, detail = ""): AIProviderError {
  const suffix = detail ? `: ${detail.slice(0, 160)}` : "";
  if (status === 401 || status === 403) return new AIProviderError("auth", `credentials rejected (HTTP ${status})${suffix}`, status);
  if (status === 429) return new AIProviderError("rate_limited", `rate limited or out of credits (HTTP 429)${suffix}`, status);
  if (status >= 500) return new AIProviderError("unavailable", `service unavailable (HTTP ${status})`, status);
  return new AIProviderError("bad_request", `request rejected (HTTP ${status})${suffix}`, status);
}

/** Short, user-facing description used in fallback notices. Never includes secrets. */
export function describeError(e: unknown): string {
  if (e instanceof AIProviderError) return e.message;
  return e instanceof Error ? e.message : String(e);
}
