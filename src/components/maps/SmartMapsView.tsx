"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { CATEGORIES, DEMO_MAP_PROPERTY, SAMPLE_PLACES } from "@/lib/maps/sampleData";
import { directionsUrl, formatDistance, formatDuration, openStreetMapUrl, returnToAccommodationUrl, straightLineMeters } from "@/lib/maps/geo";
import type { Recommendation, ConciergeIntent } from "@/lib/maps/concierge";
import type { AIResult } from "@/lib/ai/types";
import type { PlaceCategory, RouteResult, TravelMode } from "@/lib/maps/types";
import { Badge, Button, Card, Notice, SectionTitle, SourceTag, cx, inputClass } from "../ui";
import type { AIStatus } from "../Dashboard";

const SmartMap = dynamic(() => import("./SmartMap").then((m) => m.SmartMap), {
  ssr: false,
  loading: () => <div className="flex h-[420px] items-center justify-center rounded-2xl bg-slate-100 text-sm text-slate-500">Loading map…</div>,
});

const QUESTIONS = [
  "What can we do with children near the hotel?",
  "Find Halaal food near our accommodation",
  "How do we get to the airport?",
  "Is there a hospital nearby?",
  "Where can we watch rugby?",
];

interface ConciergeResponse {
  intent: AIResult<ConciergeIntent>;
  recommendations: Recommendation[];
  placesSource: string;
  notes: string[];
}

export function SmartMapsView({ status }: { status: AIStatus | null }) {
  const property = DEMO_MAP_PROPERTY;
  const [active, setActive] = useState<PlaceCategory[]>(CATEGORIES.map((c) => c.id));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<ConciergeResponse | null>(null);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const places = useMemo(() => SAMPLE_PLACES.filter((p) => active.includes(p.category)), [active]);
  const selected = SAMPLE_PLACES.find((p) => p.id === selectedId) ?? null;

  const toggle = (id: PlaceCategory) => setActive((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]));

  const ask = async (q: string) => {
    if (!q.trim()) return;
    setQuestion(q);
    setAsking(true);
    setError(null);
    try {
      const res = await fetch("/api/concierge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: q }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Concierge failed");
      setAnswer(body);
      if (body.intent.data.categories.length) setActive(body.intent.data.categories);
      setSelectedId(body.recommendations[0]?.place.id ?? null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAsking(false);
    }
  };

  return (
    <div className="space-y-4">
      <SectionTitle title="AI Smart Maps & Travel Concierge" subtitle={`${property.name} · Durban (fictional property location)`} />

      <Notice tone="amber">
        <b>Sample data.</b> Destinations are clearly labelled samples while live Places data is pending: real landmarks have approximate
        coordinates; Halaal eateries and events are fictional placeholders. No opening hours, travel times or Halaal certification are shown
        unless they come from a live provider.
      </Notice>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-3">
          <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
            <button onClick={() => setActive(CATEGORIES.map((c) => c.id))} className="shrink-0 rounded-full bg-slate-800 px-3 py-1.5 text-xs font-medium text-white">All</button>
            {CATEGORIES.map((c) => (
              <button
                key={c.id}
                onClick={() => toggle(c.id)}
                className={cx(
                  "shrink-0 rounded-full px-3 py-1.5 text-xs font-medium ring-1",
                  active.includes(c.id) ? "bg-brand-600 text-white ring-brand-600" : "bg-white text-slate-600 ring-slate-200",
                )}
              >
                {c.icon} {c.label}
              </button>
            ))}
          </div>
          <Card className="overflow-hidden p-1">
            <SmartMap property={property} places={places} categories={CATEGORIES} selectedId={selectedId} onSelect={setSelectedId} className="h-[55vh] min-h-[340px] w-full rounded-xl" />
          </Card>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setSelectedId("__property__")}>🏡 Centre on guest house</Button>
            <a href={returnToAccommodationUrl(property.location)} target="_blank" rel="noopener noreferrer">
              <Button>🧭 Take me back to my accommodation</Button>
            </a>
          </div>

          {selected && <PlaceDetail key={selected.id} placeId={selected.id} />}
          {selectedId === "__property__" && <ArrivalCard />}
        </div>

        <div className="space-y-4">
          <Card className="p-4">
            <h3 className="font-semibold">Ask the concierge</h3>
            <p className="mb-2 text-xs text-slate-500">
              The AI interprets the question; places and facts come from the map data.{" "}
              {status && <SourceTag source={status.ai.kind} model={status.ai.model} />}
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                ask(question);
              }}
              className="flex gap-2"
            >
              <input className={inputClass} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="e.g. Where can the kids play?" />
              <Button type="submit" disabled={asking}>{asking ? "…" : "Ask"}</Button>
            </form>
            <div className="mt-2 flex flex-wrap gap-1">
              {QUESTIONS.map((q) => (
                <button key={q} onClick={() => ask(q)} className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] text-slate-600 hover:bg-slate-200">{q}</button>
              ))}
            </div>
            {error && <div className="mt-2"><Notice tone="red">{error}</Notice></div>}
            {answer && (
              <div className="mt-3 space-y-2">
                <div className="flex flex-wrap items-center gap-1">
                  <SourceTag source={answer.intent.source} model={answer.intent.model} fallbackReason={answer.intent.fallbackReason} />
                  <Badge>{answer.placesSource === "sample" ? "Sample places" : answer.placesSource}</Badge>
                </div>
                <p className="text-sm text-slate-700">{answer.intent.data.summary}</p>
                <ul className="space-y-2">
                  {answer.recommendations.map((r) => (
                    <li key={r.place.id}>
                      <button
                        onClick={() => setSelectedId(r.place.id)}
                        className={cx("w-full rounded-xl border p-2.5 text-left text-sm", selectedId === r.place.id ? "border-brand-300 bg-brand-50" : "border-slate-200 hover:bg-slate-50")}
                      >
                        <div className="font-medium">{r.place.name}</div>
                        <div className="text-xs text-slate-500">≈ {formatDistance(r.straightLineMeters)} straight-line · {r.reasons.join(" · ")}</div>
                        {r.caveats.slice(0, 2).map((c) => <div key={c} className="text-[11px] text-amber-700">⚠ {c}</div>)}
                      </button>
                    </li>
                  ))}
                  {answer.recommendations.length === 0 && <li className="text-sm text-slate-500">No matching sample places.</li>}
                </ul>
              </div>
            )}
          </Card>
          {selectedId !== "__property__" && <ArrivalCard />}
        </div>
      </div>
    </div>
  );
}

function PlaceDetail({ placeId }: { placeId: string }) {
  const property = DEMO_MAP_PROPERTY;
  const place = SAMPLE_PLACES.find((p) => p.id === placeId)!;
  const cat = CATEGORIES.find((c) => c.id === place.category)!;
  const [route, setRoute] = useState<{ result: RouteResult | null; provider: string; error?: string } | null>(null);
  const [mode, setMode] = useState<TravelMode>("driving");

  const getRoute = async (m: TravelMode) => {
    setMode(m);
    const res = await fetch("/api/maps/route", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ origin: property.location, destination: place.location, mode: m }) });
    const body = await res.json();
    setRoute({ result: body.route ?? null, provider: body.provider, error: body.error });
  };

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-xs text-slate-500">{cat.icon} {cat.label}</div>
          <h3 className="font-semibold">{place.name}</h3>
          {place.description && <p className="text-sm text-slate-600">{place.description}</p>}
        </div>
        {place.fictional ? <Badge tone="red">Fictional sample</Badge> : <Badge tone="amber">Approx. location</Badge>}
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <div>
          <dt className="text-xs text-slate-500">From the guest house</dt>
          <dd>≈ {formatDistance(straightLineMeters(property.location, place.location))} <span className="text-xs text-slate-400">(straight line, not road distance)</span></dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Opening hours</dt>
          <dd className="text-slate-500">{place.openingHours?.length ? place.openingHours.join(", ") : "Unknown — check with venue"}</dd>
        </div>
        {place.category === "halaal-food" && (
          <div className="col-span-2">
            <dt className="text-xs text-slate-500">Halaal certification</dt>
            <dd className="text-amber-800">Not verified — confirm with the venue or a recognised certifying body before relying on it.</dd>
          </div>
        )}
      </dl>
      <div className="mt-3 flex flex-wrap gap-2">
        <a href={directionsUrl(property.location, place.location, "driving")} target="_blank" rel="noopener noreferrer"><Button>🚗 Directions</Button></a>
        <a href={directionsUrl(property.location, place.location, "walking")} target="_blank" rel="noopener noreferrer"><Button variant="secondary">🚶 Walking</Button></a>
        <a href={directionsUrl(place.location, property.location, "driving")} target="_blank" rel="noopener noreferrer"><Button variant="secondary">🏡 Route back</Button></a>
        <a href={openStreetMapUrl(place.location)} target="_blank" rel="noopener noreferrer"><Button variant="ghost">OpenStreetMap ↗</Button></a>
      </div>
      <div className="mt-3 border-t border-slate-100 pt-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-500">Travel time:</span>
          {(["driving", "walking"] as const).map((m) => (
            <Button key={m} variant="ghost" className={cx("px-2 py-1 text-xs", mode === m && route && "bg-slate-100")} onClick={() => getRoute(m)}>Check {m}</Button>
          ))}
        </div>
        {route && route.result && (
          <p className="mt-1">{formatDistance(route.result.distanceMeters)} · {formatDuration(route.result.durationSeconds)} <span className="text-xs text-slate-400">via {route.result.provider}</span></p>
        )}
        {route && !route.result && (
          <p className="mt-1 text-xs text-slate-500">
            {route.error ? `Routing error: ${route.error}. ` : ""}No routing provider connected in demo mode, so no travel time is shown (we never estimate one). Use the Directions button for live Google Maps routing.
          </p>
        )}
      </div>
    </Card>
  );
}

function ArrivalCard() {
  const a = DEMO_MAP_PROPERTY.arrival;
  return (
    <Card className="p-4">
      <h3 className="font-semibold">🏡 Arrival & parking</h3>
      <p className="text-xs text-slate-500">{a.address}</p>
      <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
        <div><span className="text-xs text-slate-500">Check-in</span><div>{a.checkIn}</div></div>
        <div><span className="text-xs text-slate-500">Check-out</span><div>{a.checkOut}</div></div>
      </div>
      <h4 className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Parking</h4>
      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-sm text-slate-700">{a.parking.map((p) => <li key={p}>{p}</li>)}</ul>
      <h4 className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-400">On arrival</h4>
      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-sm text-slate-700">{a.arrival.map((p) => <li key={p}>{p}</li>)}</ul>
      <h4 className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Emergency</h4>
      <ul className="mt-1 space-y-0.5 text-sm text-slate-700">{a.emergency.map((p) => <li key={p}>{p}</li>)}</ul>
    </Card>
  );
}
