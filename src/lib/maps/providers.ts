import type { LatLng, Place, PlaceCategory, RouteResult, TravelMode } from "./types";
import { CATEGORIES, SAMPLE_PLACES } from "./sampleData";
import { straightLineMeters } from "./geo";

/**
 * Pluggable data sources for Smart Maps. The demo uses sample places and no
 * routing. Google Places (New) and Routes are prepared but stay OFF unless
 * the owner has explicitly approved billing (GOOGLE_MAPS_BILLING_APPROVED=true)
 * and supplied a server-side key.
 */
export interface PlacesProvider {
  readonly id: string;
  readonly live: boolean;
  nearby(center: LatLng, categories: PlaceCategory[], radiusMeters: number): Promise<Place[]>;
}

export interface RoutingProvider {
  readonly id: string;
  /** Returns null when no genuine routing provider is configured. */
  route(origin: LatLng, destination: LatLng, mode: TravelMode): Promise<RouteResult | null>;
}

export class SamplePlacesProvider implements PlacesProvider {
  readonly id = "sample";
  readonly live = false;
  constructor(private readonly places: Place[] = SAMPLE_PLACES) {}
  async nearby(center: LatLng, categories: PlaceCategory[], radiusMeters: number): Promise<Place[]> {
    return this.places.filter((p) => categories.includes(p.category) && straightLineMeters(center, p.location) <= radiusMeters);
  }
}

/** No routing configured — the UI then links out to Google Maps for live directions instead of guessing. */
export class NoRoutingProvider implements RoutingProvider {
  readonly id = "none";
  async route(): Promise<RouteResult | null> {
    return null;
  }
}

type FetchLike = typeof fetch;

/** Google Places API (New) — Nearby Search. PREPARED, NOT ACTIVATED (billable). */
export class GooglePlacesProvider implements PlacesProvider {
  readonly id = "google-places";
  readonly live = true;
  constructor(private readonly apiKey: string, private readonly fetchImpl: FetchLike = fetch) {}

  async nearby(center: LatLng, categories: PlaceCategory[], radiusMeters: number): Promise<Place[]> {
    const out: Place[] = [];
    for (const cat of categories) {
      const info = CATEGORIES.find((c) => c.id === cat);
      if (!info) continue;
      const res = await this.fetchImpl("https://places.googleapis.com/v1/places:searchNearby", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": this.apiKey,
          "X-Goog-FieldMask": "places.id,places.displayName,places.location,places.formattedAddress,places.regularOpeningHours.weekdayDescriptions",
        },
        body: JSON.stringify({
          includedTypes: info.googleTypes,
          maxResultCount: 10,
          locationRestriction: { circle: { center: { latitude: center.lat, longitude: center.lng }, radius: Math.min(radiusMeters, 50_000) } },
        }),
      });
      if (!res.ok) throw new Error(`Google Places request failed with HTTP ${res.status}`);
      const body = (await res.json()) as {
        places?: {
          id: string;
          displayName?: { text?: string };
          location?: { latitude: number; longitude: number };
          formattedAddress?: string;
          regularOpeningHours?: { weekdayDescriptions?: string[] };
        }[];
      };
      for (const p of body.places ?? []) {
        if (!p.location) continue;
        out.push({
          id: `g-${p.id}`,
          name: p.displayName?.text ?? "Unnamed place",
          category: cat,
          location: { lat: p.location.latitude, lng: p.location.longitude },
          address: p.formattedAddress,
          source: "google-places",
          openingHours: p.regularOpeningHours?.weekdayDescriptions,
          // Google does not certify Halaal status; it stays unverified until confirmed with a certifying body.
          ...(cat === "halaal-food" ? { halaal: { status: "unverified" as const } } : {}),
        });
      }
    }
    return out;
  }
}

/** Google Routes API — computeRoutes. PREPARED, NOT ACTIVATED (billable). */
export class GoogleRoutesProvider implements RoutingProvider {
  readonly id = "google-routes";
  constructor(private readonly apiKey: string, private readonly fetchImpl: FetchLike = fetch) {}

  async route(origin: LatLng, destination: LatLng, mode: TravelMode): Promise<RouteResult | null> {
    const travelMode = { driving: "DRIVE", walking: "WALK", transit: "TRANSIT" }[mode];
    const res = await this.fetchImpl("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": this.apiKey,
        "X-Goog-FieldMask": "routes.distanceMeters,routes.duration",
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
        destination: { location: { latLng: { latitude: destination.lat, longitude: destination.lng } } },
        travelMode,
      }),
    });
    if (!res.ok) throw new Error(`Google Routes request failed with HTTP ${res.status}`);
    const body = (await res.json()) as { routes?: { distanceMeters?: number; duration?: string }[] };
    const r = body.routes?.[0];
    if (!r || typeof r.distanceMeters !== "number" || !r.duration) return null;
    return { distanceMeters: r.distanceMeters, durationSeconds: parseInt(r.duration, 10), provider: "Google Routes API", mode };
  }
}

export interface MapsEnv {
  MAPS_PLACES_PROVIDER?: string;
  MAPS_ROUTING_PROVIDER?: string;
  GOOGLE_MAPS_API_KEY?: string;
  GOOGLE_MAPS_BILLING_APPROVED?: string;
}

export interface MapsProviders {
  places: PlacesProvider;
  routing: RoutingProvider;
  notes: string[];
}

/** Billable Google providers are only built when explicitly enabled AND approved by the owner. */
export function selectMapsProviders(env: MapsEnv = process.env as MapsEnv, fetchImpl: FetchLike = fetch): MapsProviders {
  const notes: string[] = [];
  const approved = env.GOOGLE_MAPS_BILLING_APPROVED === "true";
  const key = env.GOOGLE_MAPS_API_KEY ?? "";
  let places: PlacesProvider = new SamplePlacesProvider();
  let routing: RoutingProvider = new NoRoutingProvider();

  const wantsGoogle = (v?: string) => (v ?? "").toLowerCase() === "google";
  if (wantsGoogle(env.MAPS_PLACES_PROVIDER) || wantsGoogle(env.MAPS_ROUTING_PROVIDER)) {
    if (!approved) notes.push("Google Maps requested but GOOGLE_MAPS_BILLING_APPROVED is not 'true' — using sample data.");
    else if (!key) notes.push("Google Maps approved but GOOGLE_MAPS_API_KEY is missing — using sample data.");
    else {
      if (wantsGoogle(env.MAPS_PLACES_PROVIDER)) places = new GooglePlacesProvider(key, fetchImpl);
      if (wantsGoogle(env.MAPS_ROUTING_PROVIDER)) routing = new GoogleRoutesProvider(key, fetchImpl);
    }
  }
  if (!places.live) notes.push("Showing clearly labelled SAMPLE destinations — live Places data not connected.");
  if (routing.id === "none") notes.push("No routing provider connected — travel times are not shown; use the Google Maps directions link.");
  return { places, routing, notes };
}
