import { beforeAll, describe, expect, it } from "vitest";
import {
  MAX_SOS_PACKET_BYTES,
  PacketError,
  buildSosPacket,
  decodeSosPayload,
  generateCenterKeys,
  generateIdentity,
  initCrypto,
  openPacket,
  relayHop,
  type SosPayload,
} from "../src/lib/packet";

const sos: SosPayload = { type: "trapped", who: ["baby", "adult"], count: 3, lat: 3.4516, lon: -76.532 };

describe("SOS packet", () => {
  let center: Awaited<ReturnType<typeof generateCenterKeys>>;
  let id: Awaited<ReturnType<typeof generateIdentity>>;
  beforeAll(async () => {
    await initCrypto();
    center = await generateCenterKeys();
    id = await generateIdentity();
  });
  const build = (over = {}) => buildSosPacket(sos, { identity: id, centerPublicKey: center.publicKey, ...over });

  it("round-trips and fits in 240 bytes", () => {
    const pkt = build();
    expect(pkt.length).toBeLessThanOrEqual(MAX_SOS_PACKET_BYTES);
    const opened = openPacket(pkt, center);
    const out = decodeSosPayload(opened.payload);
    expect(out.type).toBe("trapped");
    expect([...out.who].sort()).toEqual(["adult", "baby"]);
    expect(out.count).toBe(3);
    expect(out.lat).toBeCloseTo(sos.lat, 5);
    expect(out.lon).toBeCloseTo(sos.lon, 5);
    expect(Buffer.from(opened.senderPublicKey)).toEqual(Buffer.from(id.publicKey));
  });

  it("cannot be opened with another center key", async () => {
    const other = await generateCenterKeys();
    expect(() => openPacket(build(), other)).toThrow(PacketError);
  });

  it("rejects a tampered header (timestamp)", () => {
    const pkt = build();
    pkt[23] ^= 0xff;
    expect(() => openPacket(pkt, center)).toThrowError(/bad_signature/);
  });

  it("rejects a tampered body", () => {
    const pkt = build();
    pkt[pkt.length - 1] ^= 0x01;
    expect(() => openPacket(pkt, center)).toThrowError(/decrypt_failed/);
  });

  it("rejects a signature not made by the claimed sender key", async () => {
    const other = await generateIdentity();
    const forged = buildSosPacket(sos, {
      identity: { publicKey: id.publicKey, secretKey: other.secretKey },
      centerPublicKey: center.publicKey,
    });
    expect(() => openPacket(forged, center)).toThrowError(/bad_signature/);
  });

  it("lets relays decrement TTL without breaking the signature", () => {
    const hop = relayHop(build({ ttl: 5 }))!;
    expect(hop[2]).toBe(4);
    expect(openPacket(hop, center).header.ttl).toBe(4);
  });

  it("drops the packet when TTL is exhausted", () => {
    expect(relayHop(build({ ttl: 1 }))).toBeNull();
  });

  it("does not expose the sender key in clear text", () => {
    const pkt = build();
    const body = Buffer.from(pkt.slice(24));
    expect(body.includes(Buffer.from(id.publicKey))).toBe(false);
  });
});
