/**
 * Map availability, judged from tile load events, so the UI can tell guests
 * when the background map is unavailable (offline, blocked network, tile
 * server outage) instead of showing a silent grey box.
 */
export type MapHealth = "loading" | "ok" | "degraded" | "tiles-failed" | "map-failed";

export function tileHealth(loaded: number, errors: number): MapHealth {
  if (loaded === 0 && errors === 0) return "loading";
  if (loaded === 0 && errors >= 4) return "tiles-failed";
  if (errors >= 4 && errors > loaded) return "degraded";
  return "ok";
}

export const MAP_HEALTH_MESSAGE: Record<MapHealth, string | null> = {
  loading: null,
  ok: null,
  degraded: "Some map tiles failed to load — the connection may be slow. Markers and directions still work.",
  "tiles-failed": "The background map could not load (offline or blocked). Markers, the list view and Directions buttons still work.",
  "map-failed": "The interactive map could not start on this device. Use the list view and Directions buttons instead.",
};
