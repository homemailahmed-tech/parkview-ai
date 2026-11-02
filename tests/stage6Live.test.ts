import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { verifyEvidence, type EvidenceFact } from "@/lib/ai/evidence";
import { ReplayProvider } from "@/lib/ai/replayProvider";

/* REAL Muse Spark 1.3 evidence responses from the approved Stage 6 live run (2 Nov 2026,
   docs/evidence/stage6-evidence-live.json), re-verified offline by the same deterministic code. */
const live = JSON.parse(fs.readFileSync("docs/evidence/stage6-evidence-live.json", "utf8")) as { mode: string; rows: { id: string; input: string; id_: string; facts: EvidenceFact[]; output: { value: unknown }; verdicts: { key: string; verdict: string }[] }[] };
const row = (id: string) => live.rows.find((r) => r.id === id)!;
const rerun = (id: string, countQuestionOpen: boolean) => verifyEvidence(row(id).input, row(id).facts, row(id).output.value, { countQuestionOpen });
const v = (r: ReturnType<typeof verifyEvidence>, k: string) => r.items.find((i) => i.fact.key === k)?.verdict;

describe("Stage 6 live evidence: re-verified offline", () => {
  it("is genuine live Meta evidence with response ids", () => {
    expect(live.mode).toMatch(/^LIVE \(https:\/\/api\.meta\.ai\/v1\)/);
    for (const r of live.rows) expect(r.id_).toMatch(/^chatcmpl-/);
  });

  it("re-verification reproduces the recorded verdicts exactly", () => {
    for (const [id, open] of [["E-H-3", false], ["E-H-2", true], ["E-H-1", true]] as const) {
      expect(rerun(id, open).items.map((i) => [i.fact.key, i.verdict])).toEqual(row(id).verdicts.map((x) => [x.key, x.verdict]));
    }
  });

  it("CHOIR: the parties' 8 guests conflict with the guest's 'now 16'; the 8 adults are not stated", () => {
    const r = rerun("E-H-2", true);
    expect(v(r, "totalGuests")).toBe("conflict");
    expect(v(r, "adults")).toBe("unsupported");
    for (const k of ["checkIn", "nights", "couples", "accessNeed", "separateBeds"]) expect(v(r, k), k).toBe("supported");
  });

  it("every displayed quote is a verbatim slice of the message, and no head-count is shown as confirmed where it is in doubt", () => {
    for (const r of live.rows) {
      const rep = verifyEvidence(r.input, r.facts, r.output.value);
      for (const i of rep.items.filter((x) => x.quote)) expect(r.input.normalize("NFC").slice(...i.span!)).toBe(i.quote);
    }
    for (const id of ["E-H-1", "E-H-2"]) expect(rerun(id, true).items.filter((i) => ["totalGuests", "adults", "children"].includes(i.fact.key) && i.verdict === "supported")).toEqual([]);
  });

  it("the replay file serves these exact responses, labelled REPLAY (never 'live')", async () => {
    const p = new ReplayProvider("docs/evidence/stage6-replay.json");
    expect(p.info.kind).toBe("replay");
    expect(p.info.label).toMatch(/^REPLAY · genuine Meta response captured/);
    expect(await p.citeEvidence({ message: row("E-H-2").input, facts: [] })).toEqual(row("E-H-2").output.value);
    expect(p.lastCall?.responseId).toBe(row("E-H-2").id_);
  });
});
