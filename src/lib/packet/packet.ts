import {
  decodeHeader,
  encodeAudioPayload,
  encodeHeader,
  encodeSosPayload,
  headerForSigning,
} from "./codec";
import { CenterKeys, SigningIdentity, randomBytes, seal, sign, unseal, verify } from "./crypto";
import {
  AudioPayload,
  DEFAULT_TTL,
  FLAG_AUDIO,
  HEADER_BYTES,
  PACKET_VERSION,
  PacketError,
  PacketHeader,
  SosPayload,
} from "./types";

export interface BuildOptions {
  identity: SigningIdentity;
  centerPublicKey: Uint8Array;
  urgency?: number;
  ttl?: number;
  /** Seconds since epoch. */
  timestamp?: number;
  msgId?: Uint8Array;
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function assemble(headerBytes: Uint8Array, payload: Uint8Array, o: BuildOptions): Uint8Array {
  const toSign = concat(headerForSigning(headerBytes), o.identity.publicKey, payload);
  const sig = sign(toSign, o.identity.secretKey);
  const body = seal(concat(o.identity.publicKey, sig, payload), o.centerPublicKey);
  return concat(headerBytes, body);
}

function baseHeader(o: BuildOptions, flags: number): PacketHeader {
  return {
    version: PACKET_VERSION,
    urgency: o.urgency ?? 3,
    ttl: o.ttl ?? DEFAULT_TTL,
    flags,
    msgId: o.msgId ?? randomBytes(16),
    timestamp: o.timestamp ?? Math.floor(Date.now() / 1000),
  };
}

export function buildSosPacket(sos: SosPayload, o: BuildOptions): Uint8Array {
  return assemble(encodeHeader(baseHeader(o, 0)), encodeSosPayload(sos), o);
}

export function buildAudioPacket(audio: AudioPayload, o: BuildOptions): Uint8Array {
  return assemble(encodeHeader(baseHeader(o, FLAG_AUDIO)), encodeAudioPayload(audio), o);
}

export interface OpenedPacket {
  header: PacketHeader;
  senderPublicKey: Uint8Array;
  payload: Uint8Array;
}

/** Unseals and verifies the signature. Throws PacketError on any failure. */
export function openPacket(packet: Uint8Array, center: CenterKeys): OpenedPacket {
  if (packet.length <= HEADER_BYTES) throw new PacketError("too_short");
  const headerBytes = packet.slice(0, HEADER_BYTES);
  const header = decodeHeader(headerBytes);
  const plain = unseal(packet.slice(HEADER_BYTES), center);
  if (!plain || plain.length < 32 + 64) throw new PacketError("decrypt_failed");
  const senderPublicKey = plain.slice(0, 32);
  const sig = plain.slice(32, 96);
  const payload = plain.slice(96);
  const signed = concat(headerForSigning(headerBytes), senderPublicKey, payload);
  if (!verify(sig, signed, senderPublicKey)) throw new PacketError("bad_signature");
  return { header, senderPublicKey, payload };
}

/** What a relay phone does: lower TTL without reading or re-signing anything. Returns null when TTL runs out. */
export function relayHop(packet: Uint8Array): Uint8Array | null {
  const ttl = packet[2];
  if (ttl <= 1) return null;
  const copy = packet.slice();
  copy[2] = ttl - 1;
  return copy;
}
