import { NextResponse } from "next/server";
import { resolveAIConfig, type AIEnv } from "@/lib/ai/config";
import { fetchCatalog } from "@/lib/ai/catalog";

export const dynamic = "force-dynamic";

/**
 * Owner-only: lists the Meta models the selected provider account can use
 * (GET /models — no tokens, no model call, no charge). Gated by the same
 * AI_CONNECTION_TEST_TOKEN as the connection test so the key isn't usable by visitors.
 */
export async function POST(req: Request) {
  const expected = process.env.AI_CONNECTION_TEST_TOKEN;
  if (!expected) return NextResponse.json({ ok: false, detail: "Catalogue check is disabled (AI_CONNECTION_TEST_TOKEN not set)" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { token?: unknown };
  if (body.token !== expected) return NextResponse.json({ ok: false, detail: "Invalid token" }, { status: 401 });

  const cfg = resolveAIConfig(process.env as AIEnv);
  const target = cfg.candidate;
  if (!target) return NextResponse.json({ ok: false, detail: "AI_MODE is simulation — choose a provider first" });
  if (!target.apiKey || !target.baseUrl) return NextResponse.json({ ok: false, detail: `${target.label}: API key or base URL missing` });
  return NextResponse.json(await fetchCatalog(target));
}
