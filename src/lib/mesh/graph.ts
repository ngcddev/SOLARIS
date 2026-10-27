import { haversineM } from "../geo/geo";

export type NodeKind = "phone" | "lora" | "gateway";

export interface MeshNode {
  id: string;
  kind: NodeKind;
  lat: number;
  lon: number;
}

export const BLE_RANGE_M = 50;
export const LORA_RANGE_M = 2500;

/** Deterministic PRNG so scenarios and demos are reproducible. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function offsetM(lat: number, lon: number, dxM: number, dyM: number): [number, number] {
  const dLat = dyM / 111_320;
  const dLon = dxM / (111_320 * Math.cos((lat * Math.PI) / 180));
  return [lat + dLat, lon + dLon];
}

/** LoRa trunk nodes talk to each other over long range; everything involving a phone uses Bluetooth range. */
export function areLinked(a: MeshNode, b: MeshNode, bleRangeM = BLE_RANGE_M): boolean {
  const range = a.kind !== "phone" && b.kind !== "phone" ? LORA_RANGE_M : bleRangeM;
  return haversineM(a.lat, a.lon, b.lat, b.lon) <= range;
}

export interface Hop {
  step: number;
  from: string;
  to: string;
  /** Hops left on arrival at `to`. */
  ttl: number;
}
export interface Suppressed {
  step: number;
  from: string;
  node: string;
}
export interface Delivery {
  gateway: string;
  /** Relays after the origin, ending at the gateway. */
  path: string[];
}
export interface FloodResult {
  hops: Hop[];
  /** Copies dropped because the node had already seen the message (per-node dedup). */
  suppressed: Suppressed[];
  deliveries: Delivery[];
  /** Number of distinct nodes that handled (relayed) the message. */
  relayed: string[];
}

/**
 * Controlled flooding: every node forwards a message once (per-node dedup), TTL shrinks per hop,
 * gateways are sinks. Relays only see opaque ciphertext.
 */
export function flood(nodes: MeshNode[], originId: string, ttl = 10, bleRangeM = BLE_RANGE_M): FloodResult {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const origin = byId.get(originId);
  const result: FloodResult = { hops: [], suppressed: [], deliveries: [], relayed: [] };
  if (!origin) return result;
  const seen = new Set<string>([originId]);
  let frontier: { id: string; ttl: number; path: string[] }[] = [{ id: originId, ttl, path: [] }];
  let step = 0;
  while (frontier.length) {
    step++;
    const next: typeof frontier = [];
    for (const f of frontier) {
      if (f.ttl <= 0) continue;
      const from = byId.get(f.id)!;
      for (const n of nodes) {
        if (n.id === f.id || !areLinked(from, n, bleRangeM)) continue;
        if (seen.has(n.id)) {
          result.suppressed.push({ step, from: f.id, node: n.id });
          continue;
        }
        seen.add(n.id);
        const path = [...f.path, n.id];
        result.hops.push({ step, from: f.id, to: n.id, ttl: f.ttl - 1 });
        if (n.kind === "gateway") {
          result.deliveries.push({ gateway: n.id, path });
          continue; // gateways are sinks
        }
        result.relayed.push(n.id);
        next.push({ id: n.id, ttl: f.ttl - 1, path });
      }
    }
    frontier = next;
  }
  return result;
}

export function nearestNode(nodes: MeshNode[], lat: number, lon: number, kind?: NodeKind): { node: MeshNode; distM: number } | undefined {
  let best: { node: MeshNode; distM: number } | undefined;
  for (const n of nodes) {
    if (kind && n.kind !== kind) continue;
    const d = haversineM(n.lat, n.lon, lat, lon);
    if (!best || d < best.distM) best = { node: n, distM: d };
  }
  return best;
}

export interface Cluster {
  name: string;
  lat: number;
  lon: number;
}

/**
 * Builds a connected phone field around each cluster centre (random walk of 20-45 m steps) plus one LoRa node
 * per cluster and gateways near the command center. Returns phone nodes grouped by cluster.
 */
export function buildMesh(clusters: Cluster[], gateways: { id: string; lat: number; lon: number }[], opts: { seed: number; phonesPerCluster: number }) {
  const rand = mulberry32(opts.seed);
  const nodes: MeshNode[] = [];
  const phonesByCluster = new Map<string, MeshNode[]>();
  for (const g of gateways) nodes.push({ id: g.id, kind: "gateway", lat: g.lat, lon: g.lon });
  clusters.forEach((cl, ci) => {
    const lora: MeshNode = { id: `lora-${ci + 1}`, kind: "lora", lat: cl.lat, lon: cl.lon };
    nodes.push(lora);
    const phones: MeshNode[] = [];
    for (let i = 0; i < opts.phonesPerCluster; i++) {
      const anchor = i === 0 ? lora : phones[Math.floor(rand() * phones.length)];
      const angle = rand() * Math.PI * 2;
      const dist = 20 + rand() * 25;
      const [lat, lon] = offsetM(anchor.lat, anchor.lon, Math.cos(angle) * dist, Math.sin(angle) * dist);
      const p: MeshNode = { id: `ph-${ci + 1}-${i + 1}`, kind: "phone", lat, lon };
      phones.push(p);
      nodes.push(p);
    }
    phonesByCluster.set(cl.name, phones);
  });
  return { nodes, phonesByCluster };
}
