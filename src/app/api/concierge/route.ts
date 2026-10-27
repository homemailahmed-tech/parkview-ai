import { NextResponse } from "next/server";
import { interpretConcierge, selectProvider } from "@/lib/ai/service";
import { recommend } from "@/lib/maps/concierge";
import { selectMapsProviders } from "@/lib/maps/providers";
import { CATEGORIES, DEMO_MAP_PROPERTY } from "@/lib/maps/sampleData";

const RADIUS_M = 40_000;

/**
 * Guest concierge: the AI (Meta or simulation) only interprets the question;
 * places, distances and caveats come from the maps provider and deterministic code.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { question?: unknown };
  if (typeof body.question !== "string" || !body.question.trim()) {
    return NextResponse.json({ error: "Question is required" }, { status: 400 });
  }
  try {
    const intent = await interpretConcierge(selectProvider(), { question: body.question.slice(0, 500), categories: CATEGORIES.map((c) => c.id) });
    const maps = selectMapsProviders();
    const places = intent.data.categories.length ? await maps.places.nearby(DEMO_MAP_PROPERTY.location, intent.data.categories, RADIUS_M) : [];
    return NextResponse.json({
      intent,
      recommendations: recommend(intent.data, places, DEMO_MAP_PROPERTY.location),
      placesSource: maps.places.id,
      notes: maps.notes,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
