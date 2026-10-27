import { NextResponse } from "next/server";
import { selectProvider } from "@/lib/ai/service";
import { selectMapsProviders } from "@/lib/maps/providers";

export const dynamic = "force-dynamic";

/** Reports which AI and maps providers are active. Never returns secrets. */
export async function GET() {
  const sel = selectProvider();
  const maps = selectMapsProviders();
  return NextResponse.json({
    ai: { kind: sel.primary.info.kind, label: sel.primary.info.label, model: sel.primary.info.model ?? null, configIssue: sel.configIssue ?? null },
    maps: { places: maps.places.id, routing: maps.routing.id, notes: maps.notes },
  });
}
