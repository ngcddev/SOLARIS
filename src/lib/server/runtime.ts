import type { Team } from "../domain/types";

/** Process-wide mutable runtime state (survives Next.js HMR via globalThis). */
export interface Runtime {
  /** "Simulate internet outage": forces level-3 rules everywhere. */
  offline: boolean;
  /** Mesh node positions by id (filled by the scenario / mesh simulator). */
  nodes: Map<string, { lat: number; lon: number; kind?: string }>;
  /** Fully reassembled audio by case id. */
  audioStore: Map<string, Uint8Array>;
  /** Audio that arrived before its SOS. */
  pendingAudio: Map<string, Uint8Array>;
  /** Recent graceful-degradation notes (no content, only stage + reason). */
  degradations: { at: number; stage: string; reason: string }[];
  seeded: boolean;
}

const g = globalThis as unknown as { __solarisRuntime?: Runtime };

export function getRuntime(): Runtime {
  g.__solarisRuntime ??= {
    offline: false,
    nodes: new Map(),
    audioStore: new Map(),
    pendingAudio: new Map(),
    degradations: [],
    seeded: false,
  };
  return g.__solarisRuntime;
}

export function resetRuntime() {
  const r = getRuntime();
  r.nodes.clear();
  r.audioStore.clear();
  r.pendingAudio.clear();
  r.degradations = [];
  r.seeded = false;
}

/** Rescue teams of the demo. Positions are around Cali, Colombia (fictional roster). */
export const DEFAULT_TEAMS: Team[] = [
  { id: "eq-1", name: "Cali Fire Dept · Alpha", size: 6, lat: 3.4516, lon: -76.532, status: "available" },
  { id: "eq-2", name: "Civil Defense · Bravo", size: 5, lat: 3.4372, lon: -76.5225, status: "available" },
  { id: "eq-3", name: "Red Cross · Charlie", size: 4, lat: 3.4655, lon: -76.5082, status: "available" },
  { id: "eq-4", name: "USAR Valle · Delta", size: 8, lat: 3.4231, lon: -76.5517, status: "available" },
  { id: "eq-5", name: "Volunteer Brigade · Echo", size: 4, lat: 3.4488, lon: -76.5403, status: "available" },
  { id: "eq-6", name: "Metropolitan Police · Foxtrot", size: 5, lat: 3.4012, lon: -76.5287, status: "available" },
];
