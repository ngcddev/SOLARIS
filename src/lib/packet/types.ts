export const PACKET_VERSION = 1;
export const MAX_SOS_PACKET_BYTES = 240;
export const HEADER_BYTES = 24;
export const DEFAULT_TTL = 8;

/** Emergency types as selected on the big buttons. Numeric values are wire format. */
export const EMERGENCY = { trapped: 0, injured: 1, bleeding: 2, fire: 3, other: 4 } as const;
export type EmergencyType = keyof typeof EMERGENCY;
export const EMERGENCY_BY_CODE = Object.fromEntries(
  Object.entries(EMERGENCY).map(([k, v]) => [v, k]),
) as Record<number, EmergencyType>;

/** Who is affected: bitmask on the wire. */
export const WHO = { baby: 1, child: 2, adult: 4, elder: 8 } as const;
export type WhoKind = keyof typeof WHO;

export const FLAG_AUDIO = 0b0000_0001;

export interface PacketHeader {
  version: number;
  /** General urgency hint set by the phone (1 = most urgent ... 4 = least). Unauthenticated hint only. */
  urgency: number;
  /** Remaining hops. Mutable in transit, therefore NOT covered by the signature. */
  ttl: number;
  flags: number;
  msgId: Uint8Array; // 16 bytes
  /** Seconds since epoch. */
  timestamp: number;
}

export interface SosPayload {
  type: EmergencyType;
  who: WhoKind[];
  count: number;
  lat: number;
  lon: number;
}

export interface AudioPayload {
  parentId: Uint8Array; // 16 bytes: msgId of the SOS it belongs to
  index: number;
  total: number;
  data: Uint8Array;
}

export class PacketError extends Error {
  constructor(
    public code: "too_short" | "bad_version" | "decrypt_failed" | "bad_signature" | "malformed" | "too_large",
    message?: string,
  ) {
    super(message ?? code);
    this.name = "PacketError";
  }
}
