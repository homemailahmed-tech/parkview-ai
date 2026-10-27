import { NextResponse } from "next/server";
import { resolveAIConfig, type AIEnv } from "@/lib/ai/config";
import { fetchCatalog } from "@/lib/ai/catalog";
import { requireOwner } from "@/lib/security/ownerTools";

export const dynamic = "force-dynamic";

/**
 * Owner-only: lists the Meta models the selected provider account can use
 * (GET /models — no tokens, no model call, no charge). Owner session required.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { token?: unknown };
  const refused = await requireOwner(req, body);
  if (refused) return refused;

  const cfg = resolveAIConfig(process.env as AIEnv);
  const target = cfg.candidate;
  if (!target) return NextResponse.json({ ok: false, detail: "AI_MODE is simulation — choose a provider first" });
  if (!target.apiKey || !target.baseUrl) return NextResponse.json({ ok: false, detail: `${target.label}: API key or base URL missing` });
  return NextResponse.json(await fetchCatalog(target));
}
