"use client";

import { useEffect, useRef } from "react";
import type { Circle, CircleMarker, LayerGroup, Map as LMap, Polyline } from "leaflet";
import "leaflet/dist/leaflet.css";
import s from "./map.module.css";

export interface MapMarker {
  id: string;
  lat: number;
  lon: number;
  /** CSS color (token variable resolved by the caller). */
  color: string;
  radius?: number;
  label?: string;
  selected?: boolean;
  filled?: boolean;
}
export interface MapCircle {
  id: string;
  lat: number;
  lon: number;
  radiusM: number;
  color: string;
  opacity?: number;
}
export interface MapLine {
  id: string;
  points: [number, number][];
  color: string;
  dashed?: boolean;
}

interface Props {
  center: [number, number];
  zoom?: number;
  markers?: MapMarker[];
  circles?: MapCircle[];
  lines?: MapLine[];
  onMarkerClick?: (id: string) => void;
  onMapClick?: (lat: number, lon: number) => void;
  ariaLabel: string;
  height?: string;
}

/** Leaflet + OpenStreetMap (no API key). Tiles are rendered in grayscale through CSS (see map.module.css). */
export default function LeafletMap({ center, zoom = 14, markers = [], circles = [], lines = [], onMarkerClick, onMapClick, ariaLabel, height = "100%" }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<LMap | null>(null);
  const layer = useRef<LayerGroup | null>(null);
  const leaflet = useRef<typeof import("leaflet") | null>(null);
  const clickRef = useRef(onMapClick);
  const markerClickRef = useRef(onMarkerClick);
  clickRef.current = onMapClick;
  markerClickRef.current = onMarkerClick;
  const latest = useRef({ markers, circles, lines });
  latest.current = { markers, circles, lines };

  function draw() {
    const L = leaflet.current;
    if (!L || !layer.current) return;
    layer.current.clearLayers();
    const { markers, circles, lines } = latest.current;
    for (const c of circles) {
      const circle: Circle = L.circle([c.lat, c.lon], { radius: c.radiusM, color: c.color, weight: 1, fillColor: c.color, fillOpacity: c.opacity ?? 0.12, interactive: false });
      circle.addTo(layer.current);
    }
    for (const l of lines) {
      const line: Polyline = L.polyline(l.points, { color: l.color, weight: 2, dashArray: l.dashed ? "4 6" : undefined, interactive: false });
      line.addTo(layer.current);
    }
    for (const m of markers) {
      const marker: CircleMarker = L.circleMarker([m.lat, m.lon], {
        radius: (m.radius ?? 7) + (m.selected ? 4 : 0),
        color: m.selected ? "#000" : m.color,
        weight: m.selected ? 3 : 2,
        fillColor: m.color,
        fillOpacity: m.filled === false ? 0.15 : 0.9,
      });
      if (m.label) marker.bindTooltip(m.label);
      marker.on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        markerClickRef.current?.(m.id);
      });
      marker.addTo(layer.current);
    }
  }

  useEffect(() => {
    let disposed = false;
    (async () => {
      const L = await import("leaflet");
      if (disposed || !el.current) return;
      leaflet.current = L;
      const m = L.map(el.current, { center, zoom, zoomControl: true, attributionControl: true });
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap contributors",
        className: s.tiles,
      }).addTo(m);
      layer.current = L.layerGroup().addTo(m);
      m.on("click", (e) => clickRef.current?.(e.latlng.lat, e.latlng.lng));
      map.current = m;
      draw();
    })();
    return () => {
      disposed = true;
      map.current?.remove();
      map.current = null;
      layer.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(draw, [markers, circles, lines]);

  useEffect(() => {
    map.current?.setView(center, map.current.getZoom());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center[0], center[1]]);

  return <div ref={el} className={s.map} style={{ height }} role="application" aria-label={ariaLabel} />;
}
