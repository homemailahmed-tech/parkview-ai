import { NextResponse } from "next/server";
import { draftQuoteIntro, selectProvider } from "@/lib/ai/service";
import type { DraftInput } from "@/lib/ai/types";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as DraftInput | null;
  if (!body || typeof body.guestName !== "string") return NextResponse.json({ error: "guestName is required" }, { status: 400 });
  try {
    return NextResponse.json(await draftQuoteIntro(selectProvider(), body));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
