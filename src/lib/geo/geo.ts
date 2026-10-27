import type { EarthquakeEvent } from "../domain/types";

const R = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in metres. */
export function haversineM(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = rad(bLat - aLat);
  const dLon = rad(bLon - aLon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Shape of a USGS GeoJSON feed (the subset we use). */
export interface UsgsFeed {
  features: {
    id: string;
    properties: { mag: number | null; place: string | null; time: number };
    geometry: { coordinates: [number, number, number?] }; // lon, lat, depth
  }[];
}

export function eventsFromUsgs(feed: UsgsFeed, simulated: boolean): EarthquakeEvent[] {
  return feed.features
    .filter((f) => f.properties.mag != null)
    .map((f) => ({
      id: f.id,
      time: f.properties.time,
      lat: f.geometry.coordinates[1],
      lon: f.geometry.coordinates[0],
      magnitude: f.properties.mag as number,
      place: f.properties.place ?? "Unnamed",
      simulated,
    }));
}

/** Optional real USGS feed, behind USGS_FEED_ENABLED. Falls back to nothing on any error. */
export async function fetchUsgsEvents(): Promise<EarthquakeEvent[]> {
  // VERIFY: public USGS endpoint; summary feed of significant quakes in the last day.
  const url = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_day.geojson";
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    return eventsFromUsgs((await res.json()) as UsgsFeed, false);
  } catch {
    return [];
  }
}
