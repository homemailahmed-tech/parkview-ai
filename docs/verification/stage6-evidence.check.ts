// STAGE 6 — Evidence Trail live verification (owner-approved 2 Nov 2026: <= 5 Muse Spark calls, <= US$0.03).
// Run only via a metered runner (kept private; it only sets the spend caps below). The facts come from the GENUINE Stage 5 Muse Spark extractions,
// replayed offline (no call). Only the evidence calls are live. Pass criteria: docs/verification/STAGE6_PLAN.md.
import { it, vi } from "vitest";
import fs from "node:fs";
import { selectProvider, interpretEnquiry, type ProviderSelection } from "@/lib/ai/service";
import { MetaAIProvider } from "@/lib/ai/metaProvider";
import { SimulationProvider } from "@/lib/ai/simulationProvider";
import { CallBudget } from "@/lib/ai/budget";
import { HARD_ENQUIRIES } from "@/lib/data/hardEnquiries";
import { evidenceFacts, verifyEvidence, type FactKey } from "@/lib/ai/evidence";
import { endpointTrust } from "@/lib/ai/endpoint";

const OUT = process.env.EVIDENCE ?? "stage6-evidence-live.json";
const S5 = JSON.parse(fs.readFileSync(`${__dirname}/../evidence/stage5-ledger.json`, "utf8")).calls as { n: number; responseId: string; output: string }[];
const SCEN = [
  { id: "E-H-3", msg: HARD_ENQUIRIES[2].text, s5: 1, truth: ["checkIn", "children", "accessNeed", "selfCatering"] as FactKey[], notStated: [] as FactKey[] },
  { id: "E-H-2", msg: HARD_ENQUIRIES[1].text, s5: 2, truth: ["checkIn", "nights", "couples", "accessNeed", "separateBeds"] as FactKey[], notStated: ["totalGuests", "adults"] as FactKey[] },
  { id: "E-H-1", msg: HARD_ENQUIRIES[0].text, s5: 3, truth: ["privateRoom", "accessNeed"] as FactKey[], notStated: ["totalGuests"] as FactKey[] },
];
// Offline replay of a captured Stage 5 extraction (no network): the same code path as the app.
const replay = (content: string): ProviderSelection => ({
  primary: new MetaAIProvider({ provider: "meta-model-api", label: "Meta Model API", hostLabel: "Meta", baseUrl: "https://api.meta.ai/v1", apiKey: "offline", model: "muse-spark-1.3", jsonMode: "prompt", timeoutMs: 5000, maxRetries: 0, maxOutputTokens: 1100 }, { fetchImpl: vi.fn(async () => new Response(JSON.stringify({ id: "offline", model: "muse-spark-1.3", choices: [{ message: { content }, finish_reason: "stop" }] }), { status: 200 })) as unknown as typeof fetch, sleep: async () => {} }),
  simulation: new SimulationProvider(), config: { mode: "meta-model-api", issues: [], warnings: [] }, budget: new CallBudget(10),
});

it("stage 6 evidence", async () => {
  if (process.env.APPROVED !== "yes") throw new Error("not approved");
  const sel = selectProvider(process.env as never);
  const live = sel.config.live;
  if (!live) throw new Error(`live mode not configured: ${sel.configIssue}`);
  const DRY = process.env.DRYRUN === "1";
  if (!DRY && (endpointTrust(live.baseUrl) !== "meta-official" || live.baseUrl.replace(/\/+$/, "") !== "https://api.meta.ai/v1")) throw new Error("refusing: must call https://api.meta.ai/v1");
  if (!live.spend || live.spend.maxCalls > 5 || live.spend.maxUSD > 0.03 || (live.spend.maxByKind?.voice ?? 99) > 0) throw new Error("refusing: AI_SPEND_LEDGER with at most 5 calls, US$0.03, 0 voice is required");
  const p = sel.primary as MetaAIProvider;
  const rows: Record<string, unknown>[] = [];
  const summary: Record<string, unknown> = {};
  let truthTotal = 0, truthStated = 0;
  for (const s of SCEN) {
    const cap = S5.find((c) => c.n === s.s5)!;
    const interp = await interpretEnquiry(replay(cap.output), s.msg, { today: "2026-11-01", propertyName: "Parkside Demo Guest House" });
    const v = interp.data.check.value;
    const facts = evidenceFacts({ checkIn: v.checkIn, checkOut: v.checkOut, units: interp.data.units, selfCatering: v.selfCatering }, v);
    const countOpen = interp.data.openQuestions.some((q) => q.topic === "count");
    let raw: unknown, err: string | undefined;
    for (let attempt = 0; attempt < 2 && raw === undefined; attempt++) {
      try { raw = await p.citeEvidence({ message: s.msg, facts: facts.map((f) => ({ key: f.key, label: f.label, value: f.value })) }); }
      catch (e) { err = (e as Error).message; if (!/timeout|timed out|network|fetch failed|ECONN|socket|HTTP 5\d\d|status 5\d\d|\b5\d\d\b/i.test(err)) break; } // only a technical failure (no answer) may use ONE spare call
    }
    const call = p.lastCall;
    const report = raw === undefined ? undefined : verifyEvidence(s.msg, facts, raw, { countQuestionOpen: countOpen });
    const verdict = (k: FactKey) => report?.items.find((i) => i.fact.key === k)?.verdict ?? "absent";
    const allSlices = report ? report.items.every((i) => !i.quote || s.msg.normalize("NFC").slice(i.span![0], i.span![1]) === i.quote) : false;
    const stated = s.truth.filter((k) => verdict(k) === "supported").length;
    truthTotal += s.truth.length; truthStated += stated;
    const head = report?.items.filter((i) => ["totalGuests", "adults", "children"].includes(i.fact.key) && i.verdict === "supported").map((i) => i.fact.key) ?? [];
    rows.push({ id: s.id, kind: "evidence", at: new Date().toISOString(), input: s.msg, status: raw === undefined ? "FAIL" : "DONE", source: raw === undefined ? undefined : DRY ? "test" : "meta", model: call?.servedModel, id_: call?.responseId, latencyMs: call?.latencyMs, output: { value: raw, usage: call?.usage }, error: err,
      facts, stage5Extraction: cap.responseId, verdicts: report?.items.map((i) => ({ key: i.fact.key, value: i.fact.value, verdict: i.verdict, quote: i.quote, reason: i.reason })), discarded: report?.discarded,
      checks: { a_allQuotesInMessage: allSlices, truthStated: `${stated}/${s.truth.length}`, notStatedFlagged: s.notStated.every((k) => verdict(k) === "conflict" || verdict(k) === "unsupported"), c_noHeadcountConfirmed: s.id === "E-H-3" ? true : head.length === 0 } });
    fs.writeFileSync(OUT, JSON.stringify({ mode: DRY ? "DRY RUN (local mock — not Meta)" : "LIVE (https://api.meta.ai/v1) — Stage 6 Evidence Trail", today: "2 Nov 2026", caps: live.spend, rows }, null, 2));
  }
  summary.coverage = `${truthStated}/${truthTotal}`;
  summary.d_coverage80 = truthStated / truthTotal >= 0.8;
  fs.writeFileSync(OUT, JSON.stringify({ mode: DRY ? "DRY RUN (local mock — not Meta)" : "LIVE (https://api.meta.ai/v1) — Stage 6 Evidence Trail", today: "2 Nov 2026", caps: live.spend, rows, summary }, null, 2));
  console.log(JSON.stringify(summary));
});
