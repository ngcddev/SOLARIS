import {
  AudioPayload,
  EMERGENCY,
  EMERGENCY_BY_CODE,
  FLAG_AUDIO,
  HEADER_BYTES,
  PACKET_VERSION,
  PacketError,
  PacketHeader,
  SosPayload,
  WHO,
  WhoKind,
} from "./types";

const COORD_SCALE = 1e5; // ~1.1 m of precision, enough for rescue and compact on the wire

export function encodeHeader(h: PacketHeader): Uint8Array {
  if (h.msgId.length !== 16) throw new PacketError("malformed", "msgId must be 16 bytes");
  const out = new Uint8Array(HEADER_BYTES);
  const dv = new DataView(out.buffer);
  dv.setUint8(0, h.version);
  dv.setUint8(1, h.urgency);
  dv.setUint8(2, h.ttl);
  dv.setUint8(3, h.flags);
  out.set(h.msgId, 4);
  dv.setUint32(20, h.timestamp >>> 0);
  return out;
}

export function decodeHeader(bytes: Uint8Array): PacketHeader {
  if (bytes.length < HEADER_BYTES) throw new PacketError("too_short");
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = dv.getUint8(0);
  if (version !== PACKET_VERSION) throw new PacketError("bad_version");
  return {
    version,
    urgency: dv.getUint8(1),
    ttl: dv.getUint8(2),
    flags: dv.getUint8(3),
    msgId: bytes.slice(4, 20),
    timestamp: dv.getUint32(20),
  };
}

/** Header bytes with TTL zeroed: relays decrement TTL, so it cannot be signed. */
export function headerForSigning(headerBytes: Uint8Array): Uint8Array {
  const copy = headerBytes.slice(0, HEADER_BYTES);
  copy[2] = 0;
  return copy;
}

export function encodeSosPayload(p: SosPayload): Uint8Array {
  const out = new Uint8Array(11);
  const dv = new DataView(out.buffer);
  dv.setUint8(0, EMERGENCY[p.type]);
  dv.setUint8(1, p.who.reduce((m, w) => m | WHO[w], 0));
  dv.setUint8(2, Math.max(1, Math.min(255, Math.round(p.count))));
  dv.setInt32(3, Math.round(p.lat * COORD_SCALE));
  dv.setInt32(7, Math.round(p.lon * COORD_SCALE));
  return out;
}

export function decodeSosPayload(bytes: Uint8Array): SosPayload {
  if (bytes.length < 11) throw new PacketError("malformed", "sos payload too short");
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const type = EMERGENCY_BY_CODE[dv.getUint8(0)];
  if (!type) throw new PacketError("malformed", "unknown emergency type");
  const mask = dv.getUint8(1);
  const who = (Object.keys(WHO) as WhoKind[]).filter((k) => (mask & WHO[k]) !== 0);
  return {
    type,
    who,
    count: dv.getUint8(2),
    lat: dv.getInt32(3) / COORD_SCALE,
    lon: dv.getInt32(7) / COORD_SCALE,
  };
}

export function encodeAudioPayload(a: AudioPayload): Uint8Array {
  const out = new Uint8Array(18 + a.data.length);
  out.set(a.parentId, 0);
  out[16] = a.index;
  out[17] = a.total;
  out.set(a.data, 18);
  return out;
}

export function decodeAudioPayload(bytes: Uint8Array): AudioPayload {
  if (bytes.length < 18) throw new PacketError("malformed", "audio payload too short");
  return { parentId: bytes.slice(0, 16), index: bytes[16], total: bytes[17], data: bytes.slice(18) };
}

export function isAudio(h: PacketHeader): boolean {
  return (h.flags & FLAG_AUDIO) !== 0;
}

export { PACKET_VERSION };
