import { NextResponse } from "next/server";
import { citeEvidence, selectProvider } from "@/lib/ai/service";
import type { EvidenceFact, FactKey } from "@/lib/ai/evidence";

const KEYS: FactKey[] = ["checkIn", "checkOut", "nights", "totalGuests", "adults", "children", "couples", "privateRoom", "accessNeed", "selfCatering", "separateBeds"];

/** Evidence Trail: one Muse Spark call to cite the guest's words; code verifies every citation. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { message?: unknown; facts?: unknown; countQuestionOpen?: unknown } | null;
  if (!body || typeof body.message !== "string" || !body.message.trim() || body.message.length > 4000) return NextResponse.json({ error: "message is required (max 4000 characters)" }, { status: 400 });
  if (!Array.isArray(body.facts) || body.facts.length === 0 || body.facts.length > 12) return NextResponse.json({ error: "facts are required" }, { status: 400 });
  const facts: EvidenceFact[] = [];
  for (const f of body.facts as Record<string, unknown>[]) {
    if (!f || !KEYS.includes(f.key as FactKey) || facts.some((x) => x.key === f.key)) continue;
    const kind = f.kind === "date" || f.kind === "count" || f.kind === "flag" ? f.kind : undefined;
    const ok = (kind === "count" && Number.isInteger(f.value) && (f.value as number) >= 0 && (f.value as number) < 1000) || (kind === "flag" && f.value === true) || (kind === "date" && typeof f.value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(f.value));
    if (!kind || !ok) continue;
    facts.push({ key: f.key as FactKey, kind, value: f.value as EvidenceFact["value"], label: typeof f.label === "string" ? f.label.slice(0, 60) : String(f.key), origin: f.origin === "app" ? "app" : "ai" });
  }
  if (!facts.length) return NextResponse.json({ error: "no valid facts" }, { status: 400 });
  try {
    const r = await citeEvidence(selectProvider(), body.message, facts, { countQuestionOpen: body.countQuestionOpen === true });
    return NextResponse.json(r, { status: r.ok ? 200 : 503 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
