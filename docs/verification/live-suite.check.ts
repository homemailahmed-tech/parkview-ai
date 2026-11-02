// STAGE 4 LIVE INTEGRATION TESTS — run only via a metered runner (kept private) after owner approval.
// Calls the app's real service code (the same code the API routes use) against Meta's own
// endpoint, https://api.meta.ai/v1. The in-app spend ledger (AI_SPEND_LEDGER) hard-caps calls
// and money BEFORE every request. A step only PASSES if its response is labelled "meta" (from
// Meta's endpoint) and carries a response/session id. A mock or test endpoint can never pass.
// When a cap is reached the suite STOPS and marks the remaining steps NOT RUN.
// DRYRUN=1 allows a local mock endpoint for rehearsal; every step must then FAIL its "live" check.
import { it } from "vitest";
import fs from "node:fs";
import { selectProvider, interpretEnquiry, draftClarification, explainOptions, draftQuoteIntro, transcribeSpeech } from "@/lib/ai/service";
import { HARD_ENQUIRIES } from "@/lib/data/hardEnquiries";
import { guestQuestions } from "@/lib/ai/clarify";
import { allocate } from "@/lib/allocation/engine";
import { DEMO_PROPERTY, DEMO_ROOMS } from "@/lib/data/property";
import { unitsFromExtraction } from "@/lib/enquiry/extraction";
import { endpointTrust } from "@/lib/ai/endpoint";

const OUT = process.env.EVIDENCE ?? "live-evidence.json";
const AUDIO = process.env.AUDIO_DIR ?? ".";
const DRY = process.env.DRYRUN === "1";
const TODAY = process.env.TEST_TODAY ?? new Date().toISOString().slice(0, 10);
const ctx = { today: TODAY, propertyName: DEMO_PROPERTY.name };
type Row = { id: string; kind: string; at: string; input: string; status: "PASS" | "FAIL" | "STOPPED" | "NOT RUN"; source?: string; model?: string; id_?: string; latencyMs?: number; output?: unknown; checks?: Record<string, boolean>; note?: string };
const STEPS = ["V1", "V2", "I-H-1", "I-H-2", "I-H-3", "C1", "E1", "G1"];

it("live suite", async () => {
  if (process.env.APPROVED !== "yes") throw new Error("not approved");
  const sel = selectProvider(process.env as never);
  const live = sel.config.live;
  if (!live) throw new Error(`live mode not configured: ${sel.configIssue}`);
  const trust = endpointTrust(live.baseUrl);
  if (!DRY && (trust !== "meta-official" || live.baseUrl.replace(/\/+$/, "") !== "https://api.meta.ai/v1")) throw new Error(`refusing: live tests must call https://api.meta.ai/v1 (got ${trust})`);
  if (!live.spend || live.spend.maxCalls > 8 || live.spend.maxUSD > 0.04 || (live.spend.maxByKind?.chat ?? 99) > 6 || (live.spend.maxByKind?.voice ?? 99) > 2)
    throw new Error("refusing: AI_SPEND_LEDGER with at most 8 calls (6 chat, 2 voice) and US$0.04 is required");
  const ledgerCount = () => { try { return JSON.parse(fs.readFileSync(live.spend!.file, "utf8")).calls.length as number; } catch { return 0; } };

  const rows: Row[] = [];
  const save = () => fs.writeFileSync(OUT, JSON.stringify({ mode: DRY ? "DRY RUN (local mock — not Meta)" : "LIVE (https://api.meta.ai/v1)", today: TODAY, caps: live.spend, rows }, null, 2));
  let stopped = false;
  const step = async (id: string, kind: string, input: string, run: () => Promise<{ source?: string; model?: string; id_?: string; latencyMs?: number; output: unknown; checks: Record<string, boolean>; capHit: boolean }>) => {
    if (stopped) { rows.push({ id, kind, at: new Date().toISOString(), input, status: "NOT RUN", note: "suite stopped at a spend cap" }); save(); return null; }
    const before = ledgerCount();
    const r = await run();
    const newCalls = ledgerCount() - before;
    const live = r.source === "meta" && !!r.id_ && newCalls >= 1;
    const checks = { live, ...r.checks };
    const status = r.capHit ? "STOPPED" : Object.values(checks).every(Boolean) ? "PASS" : "FAIL";
    rows.push({ id, kind, at: new Date().toISOString(), input, status, source: r.source, model: r.model, id_: r.id_, latencyMs: r.latencyMs, output: r.output, checks, note: `${newCalls} ledger call(s)` });
    save();
    if (r.capHit) stopped = true;
    return r;
  };
  const cap = (s?: string) => /spend cap/.test(s ?? "");

  // V1/V2 — Muse Voice Transcribe on synthetic speech (ffmpeg flite voice), clean and with pink noise.
  for (const [id, file, lang] of [["V1", "clean16k.wav", undefined], ["V2", "noisy16k.wav", ["english"]]] as const) {
    await step(id, "voice", `${file}: synthetic speech "twelve netball girls, two coaches and the bus driver, 13 November, two nights, one coach cannot use stairs"`, async () => {
      const r = await transcribeSpeech(sel, new Uint8Array(fs.readFileSync(`${AUDIO}/${file}`)), { languageBias: lang ? [...lang] : undefined, keywords: ["Parkside"] });
      const t = (r.transcript ?? "").toLowerCase();
      return { source: r.source, model: r.model, id_: r.sessionId, latencyMs: r.latencyMs, output: r.ok ? { transcript: r.transcript, audioDurationMs: r.audioDurationMs } : { reason: r.reason },
        checks: { netball: /netball/.test(t), twelve: /twelve|\b12\b/.test(t), coaches: /coach/.test(t), driver: /driver/.test(t), stairs: /stair/.test(t) }, capHit: cap(r.reason) };
    });
  }

  // I — Muse Spark on the three hard enquiries (criteria fixed in advance; failures are recorded, not hidden).
  const expectations: Record<string, (v: Record<string, any>, missing: string[]) => Record<string, boolean>> = {
    "H-1": (v, m) => ({ total15: (v.adults ?? 0) + (v.children ?? 0) === 15, driverOwnRoom: v.drivers === 1, noStairs: (v.groundFloorGuests ?? 0) + (v.wheelchairUsers ?? 0) >= 1, datesFlaggedForConfirmation: m.some((x) => /Friday after next/.test(x)), twoNightsUncertainHandled: (v.clarifications ?? []).length > 0 || v.nights === 2 }),
    "H-2": (v) => ({ arrive21Nov: /-11-21$/.test(v.checkIn ?? ""), threeNights: v.nights === 3, couples4: v.couples === 4, gogoQueriedOrCounted: ((v.adults ?? 0) + (v.children ?? 0) >= 16) && ((v.clarifications ?? []).length > 0 || (v.adults ?? 0) + (v.children ?? 0) === 17), noStairs: (v.groundFloorGuests ?? 0) >= 1 }),
    "H-3": (v) => ({ adults3: v.adults === 3, children3: v.children === 3, arrive14Dec: /-12-14$/.test(v.checkIn ?? ""), sevenNights: v.nights === 7, selfCatering: v.selfCatering === true, noStairs: (v.groundFloorGuests ?? 0) >= 1 }),
  };
  const interps: Record<string, any> = {};
  for (const h of HARD_ENQUIRIES) {
    await step(`I-${h.id}`, "interpret", h.text, async () => {
      const r = await interpretEnquiry(sel, h.text, ctx);
      interps[h.id] = r;
      return { source: r.source, model: r.model, id_: r.call?.responseId, latencyMs: r.call?.latencyMs, output: { value: r.data.check.value, missing: r.data.check.missing, issues: r.data.check.issues, usage: r.call?.usage, fallbackReason: r.fallbackReason },
        checks: expectations[h.id](r.data.check.value as Record<string, any>, r.data.check.missing), capHit: cap(r.fallbackReason) };
    });
  }

  await step("C1", "clarify", "clarifying reply for H-1", async () => {
    const missing = interps["H-1"]?.data.check.missing ?? ["check-in date"];
    const c = await draftClarification(sel, { guestName: "Thandeka", propertyName: DEMO_PROPERTY.name, questions: guestQuestions(missing), guestMessage: HARD_ENQUIRIES[0].text });
    return { source: c.source, model: c.model, id_: c.call?.responseId, latencyMs: c.call?.latencyMs, output: { text: c.data, usage: c.call?.usage, fallbackReason: c.fallbackReason }, checks: { notReplaced: !c.fallbackReason }, capHit: cap(c.fallbackReason) };
  });

  const units = unitsFromExtraction({ checkIn: "2026-11-21", checkOut: "2026-11-23", adults: 14, couples: 4, drivers: 1, wheelchairUsers: 1 }, "Lindiwe");
  const alloc = allocate({ checkIn: "2026-11-21", checkOut: "2026-11-23", units }, { rooms: DEMO_ROOMS, bookings: [] });
  const roomNames = Object.fromEntries(DEMO_ROOMS.map((r) => [r.id, r.name]));
  await step("E1", "explain", "choir options A/B (engine facts)", async () => {
    const e = await explainOptions(sel, { guestName: "Lindiwe", options: alloc.options, comparison: alloc.comparison ?? "", roomNames });
    return { source: e.source, model: e.model, id_: e.call?.responseId, latencyMs: e.call?.latencyMs, output: { text: e.data, usage: e.call?.usage, fallbackReason: e.fallbackReason }, checks: { notReplaced: !e.fallbackReason }, capHit: cap(e.fallbackReason) };
  });
  await step("G1", "greeting", "choir quote greeting", async () => {
    const g = await draftQuoteIntro(sel, { guestName: "Lindiwe", checkIn: "2026-11-21", checkOut: "2026-11-23", optionTitle: alloc.options[0]?.title ?? "Option A", roomNames: alloc.options[0]?.assignments.map((a) => roomNames[a.roomId]) ?? [], notes: ["Includes 5% group discount."], propertyName: DEMO_PROPERTY.name });
    return { source: g.source, model: g.model, id_: g.call?.responseId, latencyMs: g.call?.latencyMs, output: { text: g.data, usage: g.call?.usage, fallbackReason: g.fallbackReason }, checks: { notReplaced: !g.fallbackReason }, capHit: cap(g.fallbackReason) };
  });

  for (const s of STEPS) if (!rows.some((r) => r.id === s)) rows.push({ id: s, kind: "?", at: new Date().toISOString(), input: "", status: "NOT RUN" });
  save();
  console.log(rows.map((r) => `${r.status} ${r.id} ${r.source ?? ""} ${Object.entries(r.checks ?? {}).filter(([, v]) => !v).map(([k]) => "✗" + k).join(" ")}`).join("\n"));
});
