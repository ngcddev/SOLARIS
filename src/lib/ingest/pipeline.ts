import type { Case, RejectReason } from "../domain/types";
import type { IngestConfig } from "../config";
import {
  CenterKeys,
  PacketError,
  decodeAudioPayload,
  decodeSosPayload,
  isAudio,
  openPacket,
  sosPayloadSchema,
  toHex,
} from "../packet";
import type { Repository } from "../repo/Repository";

export interface IngestContext {
  repo: Repository;
  center: CenterKeys;
  config: IngestConfig;
  /** Epoch ms; injectable for tests and the scenario. */
  now?: number;
}

export interface IngestInput {
  packet: Uint8Array;
  /** Mesh node ids the message traversed before reaching the gateway. */
  path?: string[];
}

export type IngestResult =
  | { status: "accepted"; kind: "sos"; case: Case }
  | { status: "accepted"; kind: "audio"; parentId: string; audio?: Uint8Array }
  | { status: "duplicate"; id: string; paths: number }
  | { status: "rejected"; reason: RejectReason; id?: string };

const fingerprint = (hex: string) => hex.slice(0, 8);

/**
 * Secure ingestion: unseal -> verify signature -> revocation -> timestamp window ->
 * replay/dedup -> per-identity rate limit -> Zod validation -> store.
 * Decrypted content is never logged.
 */
export async function ingest(input: IngestInput, ctx: IngestContext): Promise<IngestResult> {
  const now = ctx.now ?? Date.now();
  const { repo, config } = ctx;
  const path = input.path ?? [];
  await repo.bumpMetric("received");

  const reject = async (reason: RejectReason, id?: string): Promise<IngestResult> => {
    await repo.logRejection({ at: now, reason, id });
    await repo.bumpMetric(reason === "replay" ? "replaysBlocked" : "rejected");
    return { status: "rejected", reason, id };
  };

  let opened;
  try {
    opened = openPacket(input.packet, ctx.center);
  } catch (e) {
    if (e instanceof PacketError) {
      const reason: RejectReason = e.code === "bad_signature" ? "bad_signature" : e.code === "decrypt_failed" ? "decrypt_failed" : "malformed";
      return reject(reason);
    }
    return reject("malformed");
  }

  const id = toHex(opened.header.msgId);
  const senderKey = toHex(opened.senderPublicKey);

  if (await repo.isRevoked(senderKey)) return reject("revoked", id);

  const ageS = now / 1000 - opened.header.timestamp;
  if (ageS > config.replayWindowS || ageS < -config.replayWindowS) return reject("stale_timestamp", id);

  // Replay vs. multi-path duplicate. Only authenticated packets reach this point,
  // so an attacker cannot poison the seen-set with forged ids.
  const pathKey = path.join(">");
  const seen = await repo.getSeen(id);
  if (seen) {
    const withinDedup = now - seen.firstSeen <= config.dedupWindowS * 1000;
    if (withinDedup && !seen.pathKeys.includes(pathKey)) {
      seen.pathKeys.push(pathKey);
      await repo.putSeen(id, seen);
      const existing = await repo.getCase(id);
      if (existing) {
        existing.paths.push(path);
        existing.events.push({ at: now, kind: "duplicate_path", note: `Llegó también por otro camino (${path.length} saltos)` });
        await repo.saveCase(existing);
      }
      await repo.bumpMetric("duplicates");
      return { status: "duplicate", id, paths: seen.pathKeys.length };
    }
    return reject("replay", id);
  }

  if (isAudio(opened.header)) {
    let audio;
    try {
      audio = decodeAudioPayload(opened.payload);
    } catch {
      return reject("invalid_payload", id);
    }
    await repo.putSeen(id, { firstSeen: now, pathKeys: [pathKey] });
    const parentId = toHex(audio.parentId);
    const whole = await repo.addAudioFragment(parentId, senderKey, audio.index, audio.total, audio.data);
    return { status: "accepted", kind: "audio", parentId, audio: whole ?? undefined };
  }

  const since = now - config.rateLimitWindowMin * 60_000;
  if ((await repo.countSenderEvents(senderKey, since)) >= config.rateLimitMax) return reject("rate_limited", id);

  let sos;
  try {
    sos = sosPayloadSchema.parse(decodeSosPayload(opened.payload));
  } catch {
    return reject("invalid_payload", id);
  }

  await repo.putSeen(id, { firstSeen: now, pathKeys: [pathKey] });
  await repo.recordSenderEvent(senderKey, now);

  const c: Case = {
    id,
    senderId: fingerprint(senderKey),
    senderKey,
    sentAt: opened.header.timestamp * 1000,
    receivedAt: now,
    type: sos.type,
    who: sos.who,
    count: sos.count,
    lat: sos.lat,
    lon: sos.lon,
    paths: [path],
    status: "new",
    priority: "P3",
    needsReview: false,
    photos: [],
    events: [{ at: now, kind: "received", note: "SOS recibido, firma verificada" }],
  };
  await repo.saveCase(c);
  await repo.bumpMetric("accepted");
  return { status: "accepted", kind: "sos", case: c };
}
