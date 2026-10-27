/**
 * Best-effort fixed-window rate limiter (per server/edge instance, in memory).
 * Stops casual abuse of a public demo — e.g. hammering AI routes or guessing
 * access codes. Not a substitute for a shared store under heavy traffic.
 */
export interface RateRule {
  limit: number;
  windowMs: number;
}

export class RateLimiter {
  private hits = new Map<string, { count: number; reset: number }>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  /** Returns seconds to wait when the limit is exceeded, otherwise 0. */
  check(key: string, rule: RateRule): number {
    const t = this.now();
    const entry = this.hits.get(key);
    if (!entry || entry.reset <= t) {
      this.hits.set(key, { count: 1, reset: t + rule.windowMs });
      if (this.hits.size > 5000) this.prune(t);
      return 0;
    }
    entry.count++;
    return entry.count > rule.limit ? Math.ceil((entry.reset - t) / 1000) : 0;
  }

  private prune(t: number) {
    for (const [k, v] of this.hits) if (v.reset <= t) this.hits.delete(k);
  }
}

/** Rules per route group. Login routes are strict to slow down code guessing. */
export function ruleFor(pathname: string): { group: string; rule: RateRule } | null {
  if (pathname.startsWith("/api/access") || pathname.startsWith("/api/owner/login")) return { group: "login", rule: { limit: 10, windowMs: 15 * 60_000 } };
  if (pathname.startsWith("/api/ai/test") || pathname.startsWith("/api/ai/catalog")) return { group: "owner-tools", rule: { limit: 10, windowMs: 60_000 } };
  if (pathname.startsWith("/api/")) return { group: "api", rule: { limit: 40, windowMs: 60_000 } };
  return null;
}

export function clientIp(headers: Headers): string {
  return headers.get("x-real-ip") ?? headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}
