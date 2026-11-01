import { NextResponse } from "next/server";
import { draftClarification, selectProvider } from "@/lib/ai/service";
import { DEMO_PROPERTY } from "@/lib/data/property";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { guestName?: unknown; questions?: unknown; guestMessage?: unknown } | null;
  if (!body || !Array.isArray(body.questions) || body.questions.length === 0) return NextResponse.json({ error: "questions are required" }, { status: 400 });
  try {
    return NextResponse.json(
      await draftClarification(selectProvider(), {
        guestName: typeof body.guestName === "string" && body.guestName.trim() ? body.guestName.trim().slice(0, 60) : "there",
        propertyName: DEMO_PROPERTY.name,
        questions: body.questions.filter((q): q is string => typeof q === "string"),
        guestMessage: typeof body.guestMessage === "string" ? body.guestMessage : "",
      }),
    );
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
