import type { LatLng, Place, PlaceCategory } from "./types";
import { CATEGORIES } from "./sampleData";
import { straightLineMeters } from "./geo";

export interface ConciergeIntent {
  categories: PlaceCategory[];
  withChildren: boolean;
  keywords: string[];
  summary: string;
}

const CATEGORY_IDS = CATEGORIES.map((c) => c.id);

const KEYWORDS: [RegExp, PlaceCategory[]][] = [
  [/hala+l|muslim|zabiha/, ["halaal-food"]],
  [/hospital|doctor|clinic|emergency|medical|pharmacy/, ["hospitals"]],
  [/universit|campus|college|ukzn|dut|graduation/, ["universities"]],
  [/shop|mall|buy|store|market/, ["shopping"]],
  [/beach|swim|sea|ocean|surf|sand/, ["beaches"]],
  [/child|kids|family|families|toddler|aquarium|zoo|playground|fun/, ["family", "beaches"]],
  [/stadium|rugby|cricket|soccer|football|match|sport|game/, ["sports"]],
  [/airport|flight|fly|plane/, ["airport"]],
  [/train|bus|taxi|transport|station|uber/, ["transport"]],
  [/event|concert|festival|what'?s on|happening|weekend/, ["events"]],
  [/eat|food|restaurant|lunch|dinner|breakfast/, ["halaal-food"]],
];

/** SIMULATION ONLY — keyword matching stand-in for the Meta model's concierge interpretation. */
export function simulateConciergeIntent(question: string, allowed: string[] = CATEGORY_IDS): ConciergeIntent {
  const q = question.toLowerCase();
  const cats = new Set<PlaceCategory>();
  const keywords: string[] = [];
  for (const [re, cs] of KEYWORDS) {
    const m = q.match(re);
    if (m) {
      keywords.push(m[0]);
      // Generic "food" only maps to Halaal food when nothing more specific matched.
      if (cs[0] === "halaal-food" && re.source.startsWith("eat") && cats.size > 0) continue;
      cs.forEach((c) => allowed.includes(c) && cats.add(c));
    }
  }
  const withChildren = /child|kids|family|families|toddler|baby|son|daughter/.test(q);
  const categories = [...cats];
  const labels = categories.map((c) => CATEGORIES.find((x) => x.id === c)!.label.toLowerCase());
  return {
    categories,
    withChildren,
    keywords,
    summary: categories.length
      ? `Looking for ${labels.join(", ")}${withChildren ? " suitable for children" : ""} near the accommodation.`
      : "I couldn't match that to a category — try asking about food, beaches, family attractions, shopping or transport.",
  };
}

/** Validates untrusted intent JSON (e.g. from the Meta model). Unknown categories are dropped. */
export function validateConciergeIntent(raw: unknown, allowed: string[] = CATEGORY_IDS): ConciergeIntent {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const categories = Array.isArray(src.categories)
    ? [...new Set(src.categories.filter((c): c is PlaceCategory => typeof c === "string" && allowed.includes(c)))]
    : [];
  const keywords = Array.isArray(src.keywords) ? src.keywords.filter((k): k is string => typeof k === "string").slice(0, 10) : [];
  const summary = typeof src.summary === "string" ? src.summary.slice(0, 300) : "";
  return { categories, withChildren: src.withChildren === true, keywords, summary };
}

export interface Recommendation {
  place: Place;
  /** Straight-line distance from the accommodation — NOT a road distance. */
  straightLineMeters: number;
  reasons: string[];
  caveats: string[];
}

/**
 * Deterministic ranking: filter by category, prefer family-friendly places
 * for children, then nearest first. Facts come only from the place records.
 */
export function recommend(intent: ConciergeIntent, places: Place[], origin: LatLng, limit = 6): Recommendation[] {
  return places
    .filter((p) => intent.categories.includes(p.category))
    .map((place) => {
      const reasons: string[] = [];
      const caveats: string[] = [];
      const cat = CATEGORIES.find((c) => c.id === place.category)!;
      reasons.push(cat.label);
      if (intent.withChildren && place.familyFriendly) reasons.push("Marked family-friendly");
      if (place.fictional) caveats.push("Fictional sample placeholder — not a real venue");
      else if (place.approximateLocation) caveats.push("Sample data: location approximate, verify before travelling");
      if (place.category === "halaal-food") {
        caveats.push(
          place.halaal?.status === "verified" && place.halaal.authority
            ? `Halaal status per ${place.halaal.authority}`
            : "Halaal certification not verified — confirm with the venue or a certifying body",
        );
      }
      if (!place.openingHours?.length) caveats.push("Opening hours unknown — check with the venue");
      return { place, straightLineMeters: straightLineMeters(origin, place.location), reasons, caveats };
    })
    .sort((a, b) => {
      if (intent.withChildren) {
        const fa = a.place.familyFriendly ? 0 : 1;
        const fb = b.place.familyFriendly ? 0 : 1;
        if (fa !== fb) return fa - fb;
      }
      return a.straightLineMeters - b.straightLineMeters;
    })
    .slice(0, limit);
}

export interface ConciergeAnswerParts {
  places: Place[];
  placesSource: string;
  notes: string[];
}

/**
 * Fetches places for an intent, falling back to the sample provider when a
 * live provider fails, so guests still get labelled sample answers.
 */
export async function fetchPlacesWithFallback(
  intent: ConciergeIntent,
  origin: LatLng,
  radiusMeters: number,
  primary: { id: string; nearby(c: LatLng, cats: PlaceCategory[], r: number): Promise<Place[]> },
  fallback: { id: string; nearby(c: LatLng, cats: PlaceCategory[], r: number): Promise<Place[]> },
): Promise<ConciergeAnswerParts> {
  if (!intent.categories.length) return { places: [], placesSource: primary.id, notes: [] };
  try {
    return { places: await primary.nearby(origin, intent.categories, radiusMeters), placesSource: primary.id, notes: [] };
  } catch (e) {
    if (primary.id === fallback.id) throw e;
    return {
      places: await fallback.nearby(origin, intent.categories, radiusMeters),
      placesSource: fallback.id,
      notes: [`Live places lookup failed (${(e as Error).message}) — showing labelled sample places instead.`],
    };
  }
}
