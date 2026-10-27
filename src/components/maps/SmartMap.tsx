"use client";

import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";
import type { Map as LeafletMap, LayerGroup } from "leaflet";
import type { CategoryInfo, MapProperty, Place } from "@/lib/maps/types";
import { tileHealth, type MapHealth } from "@/lib/maps/health";

const OSM_TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

export interface SmartMapProps {
  property: MapProperty;
  places: Place[];
  categories: CategoryInfo[];
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  /** Reports tile/map failures so the parent can show a notice and a list fallback. */
  onHealthChange?: (health: MapHealth) => void;
  /** Swap in a commercial tile provider for production traffic. */
  tileUrl?: string;
  tileAttribution?: string;
  className?: string;
}

/**
 * Reusable interactive map for any hospitality property. Uses Leaflet with
 * OpenStreetMap tiles (no API key, no billing). Pass a different `property`
 * and `places` to reuse it for another guest house.
 */
export function SmartMap({
  property,
  places,
  categories,
  selectedId,
  onSelect,
  onHealthChange,
  tileUrl = OSM_TILES,
  tileAttribution = OSM_ATTRIBUTION,
  className,
}: SmartMapProps) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const layer = useRef<LayerGroup | null>(null);
  const L = useRef<typeof import("leaflet") | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onHealthRef = useRef(onHealthChange);
  onHealthRef.current = onHealthChange;

  // Create the map once.
  useEffect(() => {
    let cancelled = false;
    let resize: ResizeObserver | null = null;
    let loaded = 0;
    let errors = 0;
    let last: MapHealth = "loading";
    const report = () => {
      const h = tileHealth(loaded, errors);
      if (h !== last) {
        last = h;
        onHealthRef.current?.(h);
      }
    };
    import("leaflet")
      .then((leaflet) => {
        if (cancelled || !el.current || map.current) return;
        L.current = leaflet;
        const m = leaflet
          // Wheel zoom off so page scrolling on laptops doesn't hijack the map; pinch-zoom still works on phones.
          .map(el.current, { zoomControl: true, attributionControl: true, scrollWheelZoom: false })
          .setView([property.location.lat, property.location.lng], property.zoom);
        leaflet
          .tileLayer(tileUrl, { maxZoom: 19, attribution: tileAttribution })
          .on("tileload", () => {
            loaded++;
            report();
          })
          .on("tileerror", () => {
            errors++;
            report();
          })
          .addTo(m);
        layer.current = leaflet.layerGroup().addTo(m);
        map.current = m;
        m.on("click", () => onSelectRef.current?.(null));
        // Keep tiles aligned when the container changes size (rotation, tab switches, mobile toolbars).
        resize = new ResizeObserver(() => m.invalidateSize());
        resize.observe(el.current);
        draw();
      })
      .catch(() => {
        if (!cancelled) onHealthRef.current?.("map-failed");
      });
    return () => {
      cancelled = true;
      resize?.disconnect();
      map.current?.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [property.id]);

  const draw = () => {
    const leaflet = L.current;
    const m = map.current;
    const group = layer.current;
    if (!leaflet || !m || !group) return;
    group.clearLayers();

    const home = leaflet.marker([property.location.lat, property.location.lng], {
      icon: leaflet.divIcon({ className: "", html: '<div class="map-pin home" style="width:36px;height:36px">🏡</div>', iconSize: [36, 36], iconAnchor: [18, 18] }),
      zIndexOffset: 1000,
      title: property.name,
    });
    home.bindTooltip(`${property.name}${property.fictional ? " (fictional)" : ""}`, { direction: "top", offset: [0, -16] });
    home.on("click", () => onSelectRef.current?.("__property__"));
    group.addLayer(home);

    for (const p of places) {
      const cat = categories.find((c) => c.id === p.category);
      const selected = p.id === selectedId;
      const cls = ["map-pin", selected && "selected", p.fictional && "sample-fictional"].filter(Boolean).join(" ");
      const size = selected ? 34 : 30;
      const marker = leaflet.marker([p.location.lat, p.location.lng], {
        icon: leaflet.divIcon({ className: "", html: `<div class="${cls}" style="width:${size}px;height:${size}px">${cat?.icon ?? "📍"}</div>`, iconSize: [size, size], iconAnchor: [size / 2, size / 2] }),
        title: p.name,
        zIndexOffset: selected ? 900 : 0,
      });
      marker.bindTooltip(p.name, { direction: "top", offset: [0, -14] });
      marker.on("click", (ev) => {
        leaflet.DomEvent.stopPropagation(ev);
        onSelectRef.current?.(p.id);
      });
      group.addLayer(marker);
    }
  };

  // Redraw markers when data or selection changes.
  useEffect(() => {
    draw();
    const m = map.current;
    const sel = places.find((p) => p.id === selectedId);
    if (m && sel) m.panTo([sel.location.lat, sel.location.lng], { animate: true });
    if (m && selectedId === "__property__") m.setView([property.location.lat, property.location.lng], Math.max(m.getZoom(), 14));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [places, selectedId, categories]);

  return <div ref={el} className={className ?? "h-[420px] w-full rounded-2xl"} role="application" aria-label={`Map around ${property.name}`} />;
}

