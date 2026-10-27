import type { Case, EarthquakeEvent, Metrics, Rejection, Team } from "../domain/types";

export interface SeenRecord {
  firstSeen: number;
  /** Serialised paths already counted for this message id. */
  pathKeys: string[];
}

/**
 * Storage boundary. The MVP ships a MemoryRepository; Supabase/Postgres is the target
 * (see supabase/schema.sql). Everything is async so a DB-backed one is a drop-in.
 */
export interface Repository {
  // cases
  getCase(id: string): Promise<Case | undefined>;
  saveCase(c: Case): Promise<void>;
  listCases(): Promise<Case[]>;

  // teams
  listTeams(): Promise<Team[]>;
  saveTeam(t: Team): Promise<void>;

  // replay / dedup state
  getSeen(id: string): Promise<SeenRecord | undefined>;
  putSeen(id: string, rec: SeenRecord): Promise<void>;

  // per-identity rate limiting
  recordSenderEvent(senderKey: string, at: number): Promise<void>;
  countSenderEvents(senderKey: string, since: number): Promise<number>;

  // revocation list
  isRevoked(senderKey: string): Promise<boolean>;
  revoke(senderKey: string): Promise<void>;

  // audio fragments keyed by parent SOS id
  addAudioFragment(parentId: string, senderKey: string, index: number, total: number, data: Uint8Array): Promise<Uint8Array | null>;

  // rejections log + metrics
  logRejection(r: Rejection): Promise<void>;
  listRejections(): Promise<Rejection[]>;
  getMetrics(): Promise<Metrics>;
  bumpMetric(key: keyof Metrics, by?: number): Promise<void>;

  // seismic events
  getEvents(): Promise<EarthquakeEvent[]>;
  setEvents(e: EarthquakeEvent[]): Promise<void>;

  reset(): Promise<void>;
}
