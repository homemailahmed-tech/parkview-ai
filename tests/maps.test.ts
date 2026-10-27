import { describe, expect, it, vi } from "vitest";
import { CATEGORIES, DEMO_MAP_PROPERTY, SAMPLE_PLACES } from "@/lib/maps/sampleData";
import { directionsUrl, isValidLatLng, returnToAccommodationUrl, straightLineMeters } from "@/lib/maps/geo";
import { recommend, simulateConciergeIntent, validateConciergeIntent } from "@/lib/maps/concierge";
import { GooglePlacesProvider, SamplePlacesProvider, selectMapsProviders } from "@/lib/maps/providers";

describe("Smart Maps sample data", () => {
  it("covers every required category", () => {
    const ids = CATEGORIES.map((c) => c.id).sort();
    expect(ids).toEqual(["airport", "beaches", "events", "family", "halaal-food", "hospitals", "shopping", "sports", "transport", "universities"]);
    for (const id of ids) expect(SAMPLE_PLACES.some((p) => p.category === id)).toBe(true);
  });

  it("labels every sample place and never invents opening hours or Halaal certification", () => {
    for (const p of SAMPLE_PLACES) {
      expect(p.source).toBe("sample");
      expect(p.fictional || p.approximateLocation).toBe(true);
      expect(p.openingHours).toBeUndefined();
      expect(isValidLatLng(p.location)).toBe(true);
      if (p.category === "halaal-food") expect(p.halaal?.status).toBe("unverified");
    }
    expect(DEMO_MAP_PROPERTY.fictional).toBe(true);
  });
});

describe("geo helpers", () => {
  it("computes straight-line distance", () => {
    // ~1 degree of latitude ≈ 111 km
    expect(straightLineMeters({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeGreaterThan(110_000);
    expect(straightLineMeters({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeLessThan(112_000);
  });

  it("builds key-free Google Maps directions links", () => {
    const url = directionsUrl(DEMO_MAP_PROPERTY.location, { lat: -29.6144, lng: 31.1197 }, "driving");
    expect(url).toMatch(/^https:\/\/www\.google\.com\/maps\/dir\/\?api=1/);
    expect(url).not.toMatch(/key=/);
    const back = returnToAccommodationUrl(DEMO_MAP_PROPERTY.location);
    expect(back).toContain(encodeURIComponent(`${DEMO_MAP_PROPERTY.location.lat},${DEMO_MAP_PROPERTY.location.lng}`));
    expect(back).not.toContain("origin=");
  });
});

describe("concierge", () => {
  it("interprets family questions", () => {
    const intent = simulateConciergeIntent("What can we do with children near the hotel?");
    expect(intent.withChildren).toBe(true);
    expect(intent.categories).toContain("family");
  });

  it("interprets Halaal food questions and flags certification as unverified", () => {
    const intent = simulateConciergeIntent("Find Halaal food near our accommodation");
    expect(intent.categories).toEqual(["halaal-food"]);
    const recs = recommend(intent, SAMPLE_PLACES, DEMO_MAP_PROPERTY.location);
    expect(recs.length).toBeGreaterThan(0);
    for (const r of recs) expect(r.caveats.join()).toMatch(/not verified/);
  });

  it("ranks nearest first and family-friendly first for children", () => {
    const recs = recommend({ categories: ["family", "beaches"], withChildren: true, keywords: [], summary: "" }, SAMPLE_PLACES, DEMO_MAP_PROPERTY.location);
    expect(recs.every((r) => r.place.familyFriendly)).toBe(true);
    for (let i = 1; i < recs.length; i++) expect(recs[i].straightLineMeters).toBeGreaterThanOrEqual(recs[i - 1].straightLineMeters);
  });

  it("drops categories a model invents", () => {
    const intent = validateConciergeIntent({ categories: ["beaches", "casinos"], withChildren: "yes" });
    expect(intent.categories).toEqual(["beaches"]);
    expect(intent.withChildren).toBe(false);
  });
});

describe("maps providers", () => {
  it("uses sample data and no routing by default", () => {
    const p = selectMapsProviders({});
    expect(p.places.live).toBe(false);
    expect(p.routing.id).toBe("none");
  });

  it("never activates billable Google APIs without explicit owner approval", () => {
    const p = selectMapsProviders({ MAPS_PLACES_PROVIDER: "google", MAPS_ROUTING_PROVIDER: "google", GOOGLE_MAPS_API_KEY: "k" });
    expect(p.places.id).toBe("sample");
    expect(p.routing.id).toBe("none");
    expect(p.notes.join()).toMatch(/BILLING_APPROVED/);
    const approved = selectMapsProviders({ MAPS_PLACES_PROVIDER: "google", MAPS_ROUTING_PROVIDER: "google", GOOGLE_MAPS_API_KEY: "k", GOOGLE_MAPS_BILLING_APPROVED: "true" });
    expect(approved.places.id).toBe("google-places");
    expect(approved.routing.id).toBe("google-routes");
  });

  it("sample provider filters by category and radius", async () => {
    const out = await new SamplePlacesProvider().nearby(DEMO_MAP_PROPERTY.location, ["airport"], 5_000);
    expect(out).toEqual([]); // the airport is further than 5 km away
    const far = await new SamplePlacesProvider().nearby(DEMO_MAP_PROPERTY.location, ["airport"], 50_000);
    expect(far).toHaveLength(1);
  });

  it("Google Places mapping keeps Halaal status unverified (mocked HTTP)", async () => {
    const f = vi.fn(async () =>
      new Response(JSON.stringify({ places: [{ id: "abc", displayName: { text: "X" }, location: { latitude: -29.85, longitude: 31.02 } }] })),
    ) as unknown as typeof fetch;
    const out = await new GooglePlacesProvider("k", f).nearby(DEMO_MAP_PROPERTY.location, ["halaal-food"], 3000);
    expect(out[0].halaal?.status).toBe("unverified");
    expect(out[0].source).toBe("google-places");
  });
});

describe("mapping failure handling", () => {
  it("classifies tile health", async () => {
    const { tileHealth } = await import("@/lib/maps/health");
    expect(tileHealth(0, 0)).toBe("loading");
    expect(tileHealth(12, 0)).toBe("ok");
    expect(tileHealth(0, 6)).toBe("tiles-failed");
    expect(tileHealth(2, 8)).toBe("degraded");
    expect(tileHealth(20, 3)).toBe("ok");
  });

  it("falls back to labelled sample places when the live Places provider fails", async () => {
    const { fetchPlacesWithFallback } = await import("@/lib/maps/concierge");
    const broken = { id: "google-places", nearby: async () => { throw new Error("HTTP 403"); } };
    const r = await fetchPlacesWithFallback({ categories: ["beaches"], withChildren: false, keywords: [], summary: "" }, DEMO_MAP_PROPERTY.location, 40_000, broken, new SamplePlacesProvider());
    expect(r.placesSource).toBe("sample");
    expect(r.places.length).toBeGreaterThan(0);
    expect(r.notes[0]).toMatch(/HTTP 403/);
  });

  it("Google Routes errors surface instead of inventing a travel time (mocked HTTP)", async () => {
    const { GoogleRoutesProvider } = await import("@/lib/maps/providers");
    const f = vi.fn(async () => new Response("denied", { status: 403 })) as unknown as typeof fetch;
    await expect(new GoogleRoutesProvider("k", f).route(DEMO_MAP_PROPERTY.location, { lat: -29.6, lng: 31.1 }, "driving")).rejects.toThrow(/403/);
    const empty = vi.fn(async () => new Response(JSON.stringify({ routes: [] }))) as unknown as typeof fetch;
    expect(await new GoogleRoutesProvider("k", empty).route(DEMO_MAP_PROPERTY.location, { lat: -29.6, lng: 31.1 }, "driving")).toBeNull();
  });
});
