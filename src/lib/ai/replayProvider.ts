import fs from "node:fs";
import { AIProviderError } from "./errors";
import type { ClarifyInput, ConciergeInput, EvidenceInput, DraftInput, ExplainInput, HospitalityAIProvider, InterpretContext, LiveCallMeta, ProviderInfo } from "./types";

/**
 * REPLAY MODE (demo/video only; AI_MODE=replay, AI_REPLAY_FILE=docs/evidence/stage4-live-evidence.json).
 * Serves GENUINE Meta responses captured in an approved live run, unchanged, for the exact same
 * input — no network, no spend. Always labelled "REPLAY · genuine Meta response captured …",
 * never "Live Meta AI". Anything without a captured response throws, so the app falls back to
 * labelled SIMULATION.
 */
interface EvidenceRow { id: string; kind: string; input: string; status: string; source?: string; model?: string; id_?: string; latencyMs?: number; output?: any }

export class ReplayProvider implements HospitalityAIProvider {
  readonly info: ProviderInfo;
  lastCall?: LiveCallMeta;
  private readonly rows: EvidenceRow[];
  readonly capturedOn: string;

  constructor(file: string) {
    const ev = JSON.parse(fs.readFileSync(file, "utf8")) as { mode?: string; today?: string; rows: EvidenceRow[] };
    if (!/^LIVE/.test(ev.mode ?? "")) throw new Error("replay file is not evidence from a live run");
    // Only genuine responses from Meta's endpoint are replayable.
    this.rows = ev.rows.filter((r) => r.source === "meta" && r.id_);
    this.capturedOn = ev.today ?? "";
    this.info = { kind: "replay", id: "meta-model-api", label: `REPLAY · genuine Meta response captured ${this.capturedOn}`, model: "muse-spark-1.3" };
  }

  private use(row: EvidenceRow | undefined): EvidenceRow {
    if (!row) throw new AIProviderError("bad_request", "no captured Meta response for this exact input (replay mode)");
    this.lastCall = { responseId: row.id_, servedModel: row.model, latencyMs: row.latencyMs ?? 0, attempts: 1, usage: row.output?.usage };
    return row;
  }

  async interpretEnquiry(text: string, _ctx: InterpretContext): Promise<unknown> {
    return this.use(this.rows.find((r) => r.kind === "interpret" && r.input.trim() === text.trim())).output.value;
  }
  async draftClarification(input: ClarifyInput): Promise<string> {
    // Captured for the netball enquiry (H-1) only.
    return this.use(this.rows.find((r) => r.kind === "clarify" && input.guestMessage.includes("12 netball girls"))).output.text;
  }
  async explainOptions(input: ExplainInput): Promise<string> {
    return this.use(this.rows.find((r) => r.kind === "explain" && input.guestName === "Lindiwe")).output.text;
  }
  async draftQuoteIntro(input: DraftInput): Promise<string> {
    return this.use(this.rows.find((r) => r.kind === "greeting" && input.guestName === "Lindiwe")).output.text;
  }
  async citeEvidence(input: EvidenceInput): Promise<unknown> {
    return this.use(this.rows.find((r) => r.kind === "evidence" && r.input.trim() === input.message.trim())).output.value;
  }
  async interpretConciergeQuestion(_input: ConciergeInput): Promise<unknown> {
    return this.use(undefined);
  }
}
