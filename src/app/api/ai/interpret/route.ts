import { NextResponse } from "next/server";
import { interpretEnquiry, selectProvider } from "@/lib/ai/service";
import { DEMO_PROPERTY } from "@/lib/data/property";
import { isValidISODate, todayISO } from "@/lib/domain/dates";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { text?: unknown; today?: unknown };
  if (typeof body.text !== "string" || !body.text.trim()) {
    return NextResponse.json({ error: "Enquiry text is required" }, { status: 400 });
  }
  const today = isValidISODate(body.today) ? body.today : todayISO();
  try {
    const result = await interpretEnquiry(selectProvider(), body.text, { today, propertyName: DEMO_PROPERTY.name });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
