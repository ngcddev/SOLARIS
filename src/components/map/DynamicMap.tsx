"use client";

import dynamic from "next/dynamic";
import { StateNotice } from "../ui";

/** Leaflet touches `window`, so it is client-only. */
const DynamicMap = dynamic(() => import("./LeafletMap"), {
  ssr: false,
  loading: () => <StateNotice kind="loading">Cargando mapa…</StateNotice>,
});

export default DynamicMap;
export type { MapMarker, MapCircle, MapLine } from "./LeafletMap";
