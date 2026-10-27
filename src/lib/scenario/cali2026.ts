import type { EarthquakeEvent } from "../domain/types";
import { buildMesh, flood, mulberry32, offsetM, type MeshNode } from "../mesh/graph";
import { SIMULATED_AUDIO_PREFIX } from "../ai/mock";
import {
  buildAudioPacket,
  buildSosPacket,
  generateIdentity,
  toBase64,
  toHex,
  randomBytes,
  type EmergencyType,
  type SigningIdentity,
  type SosPayload,
  type WhoKind,
} from "../packet";

/**
 * Demo scenario: a FICTIONAL M6.1 earthquake in Cali, Colombia (2026). Nothing here is real data.
 * Produces dozens of realistic SOS plus deliberate attacks to show the defences.
 */

export const CALI_CENTER = { lat: 3.4516, lon: -76.532 };

const CLUSTERS = [
  { name: "Centro", lat: 3.4516, lon: -76.532, weight: 0.25 },
  { name: "San Antonio", lat: 3.45, lon: -76.539, weight: 0.2 },
  { name: "El Peñón", lat: 3.454, lon: -76.544, weight: 0.15 },
  { name: "Granada", lat: 3.465, lon: -76.533, weight: 0.15 },
  { name: "Siloé", lat: 3.441, lon: -76.553, weight: 0.25 },
];
const GATEWAYS = [
  { id: "gw-1", lat: 3.4531, lon: -76.5297 },
  { id: "gw-2", lat: 3.462, lon: -76.532 },
  { id: "gw-3", lat: 3.443, lon: -76.54 },
];

const TEXT: Record<EmergencyType, string[]> = {
  trapped: [
    "Ayuda por favor, se nos cayó el techo y estamos atrapados bajo los escombros, somos {n}",
    "Mi mamá quedó atrapada en la cocina, se derrumbó la pared, hay {n} personas en la casa",
    "Estamos atrapados en el segundo piso, la escalera colapsó, somos {n} y hay un bebé",
    "Escombros por todos lados, no podemos salir, hay un niño llorando, somos {n}",
  ],
  injured: [
    "Hay {n} personas heridas en la casa, el vidrio se rompió y no podemos salir a la calle",
    "Mi vecino está herido, se le cayó una viga, necesitamos que alguien venga",
    "Somos {n} y tenemos un adulto mayor herido, estamos en el patio",
  ],
  bleeding: [
    "Hay una persona sangrando mucho, se cortó con los vidrios, necesitamos ayuda de rescate",
    "Mi hijo está sangrando, nos cayó la lámpara, somos {n} en la casa",
  ],
  fire: [
    "Se está quemando la casa del lado, hay mucho humo, somos {n} en el edificio",
    "Incendio en la cocina por el gas, hay humo en todo el segundo piso",
  ],
  other: [
    "Se agrietó el edificio completo y tenemos miedo de que se caiga, somos {n}",
    "Estamos en la calle con {n} personas, la casa quedó muy dañada",
    "Ayuda, hay un anciano solo en el tercer piso y no puede bajar",
  ],
};
const JOKE_TEXT = "jajaja es una broma, estoy probando esto, mándenme una pizza hola hola";
const WORD_N = ["", "", "dos", "tres", "cuatro", "cinco", "seis"];

export interface ScenarioDelivery {
  /** Simulated arrival time at the center, epoch ms. */
  at: number;
  packetB64: string;
  path: string[];
  label: string;
}

export interface Scenario {
  event: EarthquakeEvent;
  nodes: MeshNode[];
  deliveries: ScenarioDelivery[];
  /** Hex public keys to pre-load in the revocation list. */
  revoked: string[];
  stats: { validSos: number; audio: number; attacks: Record<string, number> };
}

const pick = <T,>(r: () => number, xs: T[]): T => xs[Math.floor(r() * xs.length)];

function pickWeighted(r: () => number) {
  let x = r();
  for (const c of CLUSTERS) {
    if ((x -= c.weight) <= 0) return c;
  }
  return CLUSTERS[0];
}

function genSos(r: () => number, lat: number, lon: number): { sos: SosPayload; text: string } {
  const t = r();
  const type: EmergencyType = t < 0.35 ? "trapped" : t < 0.6 ? "injured" : t < 0.75 ? "bleeding" : t < 0.85 ? "fire" : "other";
  const who: WhoKind[] = ["adult"];
  if (r() < 0.22) who.push("baby");
  if (r() < 0.28) who.push("child");
  if (r() < 0.22) who.push("elder");
  const count = r() < 0.1 ? 6 + Math.floor(r() * 5) : 1 + Math.floor(r() * 4);
  const n = Math.max(2, Math.min(6, count));
  const text = pick(r, TEXT[type]).replace("{n}", WORD_N[n]);
  return { sos: { type, who, count, lat, lon }, text };
}

export async function buildCaliScenario(o: { centerPublicKey: Uint8Array; now: number; seed?: number }): Promise<Scenario> {
  const r = mulberry32(o.seed ?? 2026);
  const { now } = o;
  const quakeAt = now - 50 * 60_000;
  const event: EarthquakeEvent = {
    id: "sim-cali-2026",
    time: quakeAt,
    lat: 3.4372,
    lon: -76.5225,
    magnitude: 6.1,
    place: "Cali, Valle del Cauca — SISMO SIMULADO",
    simulated: true,
  };

  const { nodes, phonesByCluster } = buildMesh(CLUSTERS, GATEWAYS, { seed: 11, phonesPerCluster: 16 });
  const deliveries: ScenarioDelivery[] = [];
  const base = { centerPublicKey: o.centerPublicKey };
  const stats = { validSos: 0, audio: 0, attacks: { replay: 0, late_replay: 0, bad_signature: 0, false_sos: 0, burst: 0, revoked: 0 } as Record<string, number> };

  const used = new Set<string>();
  const identities = new Map<string, SigningIdentity>();
  const idFor = async (nodeId: string) => {
    let id = identities.get(nodeId);
    if (!id) identities.set(nodeId, (id = await generateIdentity()));
    return id;
  };
  const takePhone = (cluster: string) => {
    const free = phonesByCluster.get(cluster)!.filter((p) => !used.has(p.id));
    const p = free[Math.floor(r() * free.length)];
    used.add(p.id);
    return p;
  };

  /** Sends one packet from a phone node through the mesh; each reached gateway is one arrival. */
  const route = (originId: string, packet: Uint8Array, sentAt: number, label: string, delayMs = 2000, single = false) => {
    const res = flood(nodes, originId, 12);
    (single ? res.deliveries.slice(0, 1) : res.deliveries).forEach((d, i) => {
      deliveries.push({ at: sentAt + delayMs + i * 1300 + Math.floor(r() * 900), packetB64: toBase64(packet), path: d.path, label });
    });
    return res.deliveries;
  };
  const ts = (ms: number) => Math.floor(ms / 1000);

  // 1) Ordinary SOS across the city
  const VALID = 44;
  let firstDelivered: { packet: Uint8Array; path: string[]; sentAt: number } | undefined;
  let secondDelivered: { packet: Uint8Array; path: string[]; sentAt: number } | undefined;
  for (let i = 0; i < VALID; i++) {
    const cluster = pickWeighted(r);
    const phone = takePhone(cluster.name);
    const [lat, lon] = offsetM(phone.lat, phone.lon, (r() - 0.5) * 20, (r() - 0.5) * 20);
    const { sos, text } = genSos(r, lat, lon);
    const sentAt = quakeAt + 90_000 + Math.floor(r() * (now - quakeAt - 3 * 60_000));
    const identity = await idFor(phone.id);
    const urgency = sos.type === "trapped" || sos.type === "fire" ? 1 : 2;
    const msgId = randomBytes(16);
    const packet = buildSosPacket(sos, { ...base, identity, urgency, msgId, timestamp: ts(sentAt) });
    const d = route(phone.id, packet, sentAt, `SOS ${cluster.name}`);
    if (d.length === 0) continue; // isolated phone: nothing arrives (a real dead zone)
    stats.validSos++;
    if (!firstDelivered) firstDelivered = { packet, path: d[0].path, sentAt };
    else if (!secondDelivered) secondDelivered = { packet, path: d[0].path, sentAt };
    if (r() < 0.45) {
      const audio = new TextEncoder().encode(SIMULATED_AUDIO_PREFIX + text);
      const ap = buildAudioPacket({ parentId: msgId, index: 0, total: 1, data: audio }, { ...base, identity, timestamp: ts(sentAt) + 1 });
      route(phone.id, ap, sentAt, "Audio", 3500);
      stats.audio++;
    }
  }

  // 2) Attack: exact replay (same path) shortly after, and a late re-send through another path
  if (firstDelivered) {
    deliveries.push({ at: firstDelivered.sentAt + 45_000, packetB64: toBase64(firstDelivered.packet), path: firstDelivered.path, label: "REPLAY" });
    stats.attacks.replay++;
  }
  if (secondDelivered) {
    deliveries.push({ at: secondDelivered.sentAt + 6 * 60_000, packetB64: toBase64(secondDelivered.packet), path: ["ph-x", "lora-9", "gw-2"], label: "REPLAY TARDÍO" });
    stats.attacks.late_replay++;
  }

  // 3) Attack: invalid signature (signed with someone else's key, claims another identity)
  {
    const victim = await generateIdentity();
    const attacker = await generateIdentity();
    const phone = takePhone("Granada");
    const sentAt = now - 25 * 60_000;
    const packet = buildSosPacket(
      { type: "trapped", who: ["baby"], count: 5, lat: phone.lat, lon: phone.lon },
      { ...base, identity: { publicKey: victim.publicKey, secretKey: attacker.secretKey }, timestamp: ts(sentAt) },
    );
    route(phone.id, packet, sentAt, "FIRMA INVÁLIDA", 2000, true);
    stats.attacks.bad_signature++;
  }

  // 4) Attack: false SOS (joke text, coordinates far from the earthquake, phone in the city)
  {
    const phone = takePhone("San Antonio");
    const sentAt = now - 18 * 60_000;
    const identity = await idFor(phone.id);
    const sos: SosPayload = { type: "trapped", who: ["baby", "child"], count: 12, lat: 4.0868, lon: -76.1954 };
    const packet = buildSosPacket(sos, { ...base, identity, urgency: 1, timestamp: ts(sentAt) });
    route(phone.id, packet, sentAt, "SOS FALSO");
    const ap = buildAudioPacket({ parentId: packet.slice(4, 20), index: 0, total: 1, data: new TextEncoder().encode(SIMULATED_AUDIO_PREFIX + JOKE_TEXT) }, { ...base, identity, timestamp: ts(sentAt) + 1 });
    route(phone.id, ap, sentAt, "Audio falso", 3500);
    stats.attacks.false_sos++;
  }

  // 5) Attack: flooding. One identity sends 8 SOS in a minute (limit applies per identity)
  {
    const phone = takePhone("Granada");
    const identity = await idFor(phone.id);
    for (let i = 0; i < 8; i++) {
      const sentAt = now - 12 * 60_000 + i * 6_000;
      const packet = buildSosPacket({ type: "other", who: ["adult"], count: 1, lat: phone.lat, lon: phone.lon }, { ...base, identity, timestamp: ts(sentAt) });
      const d = route(phone.id, packet, sentAt, "RÁFAGA", 2000, true);
      if (d.length) stats.attacks.burst++;
    }
  }

  // 6) Attack: revoked identity (lost/stolen phone reported by its owner)
  const revoked: string[] = [];
  {
    const phone = takePhone("Siloé");
    const identity = await idFor(phone.id);
    revoked.push(toHex(identity.publicKey));
    const sentAt = now - 9 * 60_000;
    const packet = buildSosPacket({ type: "bleeding", who: ["adult"], count: 2, lat: phone.lat, lon: phone.lon }, { ...base, identity, timestamp: ts(sentAt) });
    route(phone.id, packet, sentAt, "REVOCADA", 2000, true);
    stats.attacks.revoked++;
  }

  deliveries.sort((a, b) => a.at - b.at);
  return { event, nodes, deliveries, revoked, stats };
}
