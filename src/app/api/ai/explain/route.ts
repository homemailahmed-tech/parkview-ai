import { NextResponse } from "next/server";
import { explainOptions, selectProvider } from "@/lib/ai/service";
import type { ExplainInput } from "@/lib/ai/types";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as ExplainInput | null;
  if (!body || !Array.isArray(body.options)) return NextResponse.json({ error: "options are required" }, { status: 400 });
  try {
    return NextResponse.json(await explainOptions(selectProvider(), body));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
