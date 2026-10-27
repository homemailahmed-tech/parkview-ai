/**
 * Simple in-memory cap on live (billable) model calls per UTC day, so a
 * public demo link cannot run up an unexpected bill. Per server instance —
 * a safety net, not an accounting system. Once spent, the app answers in
 * clearly labelled simulation mode.
 */
export class CallBudget {
  private day = "";
  private used = 0;

  constructor(private readonly limit: number, private readonly now: () => Date = () => new Date()) {}

  /** Reserves one call. Returns false when today's budget is spent. */
  take(): boolean {
    const today = this.now().toISOString().slice(0, 10);
    if (today !== this.day) {
      this.day = today;
      this.used = 0;
    }
    if (this.used >= this.limit) return false;
    this.used++;
    return true;
  }

  get remaining(): number {
    const today = this.now().toISOString().slice(0, 10);
    return today === this.day ? Math.max(0, this.limit - this.used) : this.limit;
  }
}

let shared: CallBudget | null = null;

export function sharedBudget(limit: number): CallBudget {
  if (!shared) shared = new CallBudget(limit);
  return shared;
}
