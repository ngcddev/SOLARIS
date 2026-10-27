import type { EmergencyType, WhoKind } from "../packet/types";

export type Priority = "P1" | "P2" | "P3" | "P4";
export const PRIORITIES: Priority[] = ["P1", "P2", "P3", "P4"];

export type CaseStatus = "new" | "validated" | "false" | "assigned" | "dispatched" | "closed";

/** Where an AI-shaped result came from. Shown in the UI so the operator always knows. */
export type AiSource = "meta" | "mock" | "rules";

export interface Triage {
  emergencyType: EmergencyType;
  people: number;
  hasBabies: boolean;
  hasChildren: boolean;
  hasElderly: boolean;
  trapped: boolean;
  priority: Priority;
  /** Short, rescuer-oriented justification. Never medical advice. */
  justification: string;
  /** Internal coherence of the report as judged by the triage step (0..1). */
  coherence: number;
  source: AiSource;
  latencyMs: number;
}

export interface TrustSignal {
  id: "signature" | "seismic" | "corroboration" | "relay_proximity" | "coherence" | "field_photo";
  label: string;
  /** 0..1 contribution quality. */
  value: number;
  weight: number;
  detail: string;
}

export interface TrustBreakdown {
  /** 0..100 */
  score: number;
  signals: TrustSignal[];
  lowConfidence: boolean;
}

export interface FieldPhoto {
  id: string;
  uploadedAt: number;
  /** data URL, kept in memory only (MVP). */
  dataUrl: string;
  findings: PhotoFinding[];
  source: AiSource;
}

export interface PhotoFinding {
  phrase: string;
  count: number;
  /** Polygons in normalised 0..1 image coordinates. */
  masks: { points: [number, number][]; score: number }[];
}

export interface CaseEvent {
  at: number;
  kind: "received" | "duplicate_path" | "triaged" | "retriaged" | "validated" | "marked_false" | "assigned" | "dispatched" | "closed" | "photo" | "audio" | "trust";
  note: string;
}

export interface Case {
  id: string; // msgId hex
  senderId: string; // short sender key fingerprint
  senderKey: string; // full hex pubkey (needed for rate limiting / revocation)
  sentAt: number; // ms
  receivedAt: number; // ms
  type: EmergencyType;
  who: WhoKind[];
  count: number;
  lat: number;
  lon: number;
  /** Mesh paths (list of node ids) that carried this message to the center. */
  paths: string[][];
  status: CaseStatus;
  priority: Priority;
  needsReview: boolean;
  triage?: Triage;
  trust?: TrustBreakdown;
  transcript?: { text: string; source: AiSource };
  audio?: { bytes: number; codec2TheoreticalBytes: number; seconds: number };
  photos: FieldPhoto[];
  assignedTeamId?: string;
  /** Epoch ms when triage finished (for average triage time). */
  triagedAt?: number;
  events: CaseEvent[];
}

export type TeamStatus = "available" | "assigned" | "dispatched";
export interface Team {
  id: string;
  name: string;
  size: number;
  lat: number;
  lon: number;
  status: TeamStatus;
}

export interface Rejection {
  at: number;
  reason: RejectReason;
  /** msgId hex when known. Never decrypted content. */
  id?: string;
}

export type RejectReason =
  | "malformed"
  | "bad_signature"
  | "decrypt_failed"
  | "revoked"
  | "stale_timestamp"
  | "replay"
  | "rate_limited"
  | "invalid_payload";

export interface Metrics {
  received: number;
  accepted: number;
  duplicates: number;
  replaysBlocked: number;
  rejected: number;
}

export interface EarthquakeEvent {
  id: string;
  /** ms */
  time: number;
  lat: number;
  lon: number;
  magnitude: number;
  place: string;
  simulated: boolean;
}
