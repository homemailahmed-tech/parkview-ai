import type { LatLng, TravelMode } from "./types";

const EARTH_RADIUS_M = 6_371_000;

/**
 * Great-circle ("as the crow flies") distance. This is geometry on the
 * stored coordinates, NOT a road distance — the UI always labels it as such.
 */
export function straightLineMeters(a: LatLng, b: LatLng): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

export function formatDistance(m: number): string {
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km`;
}

export function formatDuration(s: number): string {
  const mins = Math.max(1, Math.round(s / 60));
  return mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)} h ${mins % 60} min`;
}

export function isValidLatLng(p: LatLng): boolean {
  return Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;
}

/**
 * Google Maps "Maps URLs" deep link. Opens directions in the Google Maps
 * app/site — free, requires no API key and no billing.
 */
export function directionsUrl(origin: LatLng, destination: LatLng, mode: TravelMode = "driving"): string {
  const p = new URLSearchParams({
    api: "1",
    origin: `${origin.lat},${origin.lng}`,
    destination: `${destination.lat},${destination.lng}`,
    travelmode: mode,
  });
  return `https://www.google.com/maps/dir/?${p.toString()}`;
}

/** "Take me back to my accommodation" — directions from the guest's current position (chosen by Google Maps). */
export function returnToAccommodationUrl(property: LatLng, mode: TravelMode = "driving"): string {
  const p = new URLSearchParams({ api: "1", destination: `${property.lat},${property.lng}`, travelmode: mode });
  return `https://www.google.com/maps/dir/?${p.toString()}`;
}

export function openStreetMapUrl(p: LatLng, zoom = 17): string {
  return `https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lng}#map=${zoom}/${p.lat}/${p.lng}`;
}
