import { NextResponse } from "next/server";
import { selectProvider } from "@/lib/ai/service";
import { selectMapsProviders } from "@/lib/maps/providers";
import { ownerToolsEnabled } from "@/lib/security/ownerTools";

export const dynamic = "force-dynamic";

/** Reports which AI and maps providers are active. Never returns keys or base-URL credentials. */
export async function GET() {
  const sel = selectProvider();
  const maps = selectMapsProviders();
  const live = sel.config.live;
  return NextResponse.json({
    ai: {
      kind: sel.primary.info.kind,
      provider: sel.primary.info.id,
      label: sel.primary.info.label,
      modelClass: sel.primary.info.modelClass ?? null,
      model: sel.primary.info.model ?? null,
      host: live?.hostLabel ?? null,
      jsonMode: live?.jsonMode ?? null,
      configIssue: sel.configIssue ?? null,
      warnings: sel.config.warnings,
      liveCallsRemainingToday: sel.budget?.remaining ?? null,
      connectionTestEnabled: ownerToolsEnabled(),
    },
    maps: { places: maps.places.id, routing: maps.routing.id, notes: maps.notes },
  });
}
