import { NextResponse } from "next/server";
import { selectMapsProviders } from "@/lib/maps/providers";
import { isValidLatLng } from "@/lib/maps/geo";
import type { LatLng, TravelMode } from "@/lib/maps/types";

/** Route distance/time from a genuine routing provider, or `route: null` when none is connected. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { origin?: LatLng; destination?: LatLng; mode?: TravelMode };
  const mode: TravelMode = body.mode === "walking" || body.mode === "transit" ? body.mode : "driving";
  if (!body.origin || !body.destination || !isValidLatLng(body.origin) || !isValidLatLng(body.destination)) {
    return NextResponse.json({ error: "Valid origin and destination are required" }, { status: 400 });
  }
  const { routing } = selectMapsProviders();
  try {
    return NextResponse.json({ provider: routing.id, route: await routing.route(body.origin, body.destination, mode) });
  } catch (e) {
    return NextResponse.json({ provider: routing.id, route: null, error: (e as Error).message }, { status: 502 });
  }
}
