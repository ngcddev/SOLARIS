import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Case, EarthquakeEvent, Metrics, Rejection, Team } from "../domain/types";
import type { Repository, SeenRecord } from "./Repository";

/**
 * Postgres (Supabase) implementation of the Repository, for serverless hosts where in-memory state
 * is not shared between instances. Server-only: it uses the service-role key (never expose it to the browser).
 * Schema: supabase/migrations/0001_init.sql. Deployment notes: docs/DEPLOYMENT.md.
 *
 * Errors carry only the operation name and the PostgREST message; row contents are never logged.
 */

const MAX_FRAGMENTS = 16;
const PAGE = 1000; // PostgREST returns at most 1000 rows per request by default
const REJECTION_LIMIT = 500;
export const METRIC_KEYS: (keyof Metrics)[] = ["received", "accepted", "duplicates", "replaysBlocked", "rejected"];

// ---------------------------------------------------------------------------
// Row types and pure row <-> domain mapping (exported so they can be unit-tested without a network)
// ---------------------------------------------------------------------------

export interface CaseRow {
  id: string;
  sender_key: string;
  status: string;
  priority: string;
  needs_review: boolean;
  received_at: number | string;
  /** The full domain Case. New Case fields persist here without a schema change. */
  data: Case;
}
export interface TeamRow { id: string; name: string; size: number; lat: number; lon: number; status: string }
export interface SeenRow { id: string; first_seen: number | string; path_keys: string[] }
export interface RejectionRow { at: number | string; reason: string; msg_id: string | null }
export interface EventRow { id: string; data: EarthquakeEvent }
export interface MetricRow { key: string; value: number | string }
export interface FragmentRow { parent_id: string; idx: number; sender_key: string; total: number; data: string }

export function caseToRow(c: Case): CaseRow {
  return { id: c.id, sender_key: c.senderKey, status: c.status, priority: c.priority, needs_review: c.needsReview, received_at: c.receivedAt, data: c };
}

/** Indexed columns are authoritative for the fields they duplicate (so a manual SQL fix of `status` is honoured). */
export function rowToCase(r: CaseRow): Case {
  return {
    ...r.data,
    id: r.id,
    senderKey: r.sender_key,
    status: r.status as Case["status"],
    priority: r.priority as Case["priority"],
    needsReview: r.needs_review,
    receivedAt: Number(r.received_at),
  };
}

export const teamToRow = (t: Team): TeamRow => ({ id: t.id, name: t.name, size: t.size, lat: t.lat, lon: t.lon, status: t.status });
export const rowToTeam = (r: TeamRow): Team => ({ id: r.id, name: r.name, size: r.size, lat: r.lat, lon: r.lon, status: r.status as Team["status"] });

export const seenToRow = (id: string, rec: SeenRecord): SeenRow => ({ id, first_seen: rec.firstSeen, path_keys: rec.pathKeys });
export const rowToSeen = (r: SeenRow): SeenRecord => ({ firstSeen: Number(r.first_seen), pathKeys: [...r.path_keys] });

export const rejectionToRow = (r: Rejection): RejectionRow => ({ at: r.at, reason: r.reason, msg_id: r.id ?? null });
export function rowToRejection(r: RejectionRow): Rejection {
  const out: Rejection = { at: Number(r.at), reason: r.reason as Rejection["reason"] };
  if (r.msg_id != null) out.id = r.msg_id;
  return out;
}

export const eventToRow = (e: EarthquakeEvent): EventRow => ({ id: e.id, data: e });
export const rowToEvent = (r: EventRow): EarthquakeEvent => r.data;

export function rowsToMetrics(rows: MetricRow[]): Metrics {
  const m: Metrics = { received: 0, accepted: 0, duplicates: 0, replaysBlocked: 0, rejected: 0 };
  for (const r of rows) if ((METRIC_KEYS as string[]).includes(r.key)) m[r.key as keyof Metrics] = Number(r.value);
  return m;
}

export const bytesToBase64 = (b: Uint8Array) => Buffer.from(b).toString("base64");
export const base64ToBytes = (s: string) => new Uint8Array(Buffer.from(s, "base64"));

/** Concatenates fragments ordered by index. Returns null if an index in 0..total-1 is missing. */
export function assembleFragments(rows: Pick<FragmentRow, "idx" | "data">[], total: number): Uint8Array | null {
  const byIdx = new Map(rows.map((r) => [r.idx, base64ToBytes(r.data)]));
  const parts: Uint8Array[] = [];
  for (let i = 0; i < total; i++) {
    const p = byIdx.get(i);
    if (!p) return null;
    parts.push(p);
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

function check<T extends { error: { message: string } | null }>(res: T, op: string): T {
  if (res.error) throw new Error(`Supabase ${op} failed: ${res.error.message}`);
  return res;
}

export function createSupabaseClient(url: string, serviceRoleKey: string): SupabaseClient {
  // Stateless server client: no session persistence, no token refresh.
  return createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

export class SupabaseRepository implements Repository {
  constructor(private db: SupabaseClient) {}

  static fromEnv(env: Record<string, string | undefined> = process.env): SupabaseRepository {
    const url = env.SUPABASE_URL;
    const key = env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
    return new SupabaseRepository(createSupabaseClient(url, key));
  }

  // cases --------------------------------------------------------------------
  async getCase(id: string) {
    const { data } = check(await this.db.from("cases").select("*").eq("id", id).maybeSingle(), "getCase");
    return data ? rowToCase(data as CaseRow) : undefined;
  }
  async saveCase(c: Case) {
    check(await this.db.from("cases").upsert(caseToRow(c), { onConflict: "id" }), "saveCase");
  }
  async listCases() {
    const out: Case[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data } = check(await this.db.from("cases").select("*").order("received_at", { ascending: true }).order("id").range(from, from + PAGE - 1), "listCases");
      const rows = (data ?? []) as CaseRow[];
      out.push(...rows.map(rowToCase));
      if (rows.length < PAGE) return out;
    }
  }

  // teams --------------------------------------------------------------------
  async listTeams() {
    const { data } = check(await this.db.from("teams").select("*").order("id"), "listTeams");
    return ((data ?? []) as TeamRow[]).map(rowToTeam);
  }
  async saveTeam(t: Team) {
    check(await this.db.from("teams").upsert(teamToRow(t), { onConflict: "id" }), "saveTeam");
  }

  // replay / dedup -----------------------------------------------------------
  async getSeen(id: string) {
    const { data } = check(await this.db.from("seen_messages").select("*").eq("id", id).maybeSingle(), "getSeen");
    return data ? rowToSeen(data as SeenRow) : undefined;
  }

  /**
   * Insert-if-not-exists, atomically, in a single SQL statement (put_seen): an existing row is never
   * overwritten (first_seen is immutable) and only new path keys are appended. Returns true when this
   * call created the row.
   */
  async claimSeen(id: string, rec: SeenRecord): Promise<boolean> {
    const { data } = check(await this.db.rpc("put_seen", { p_id: id, p_first_seen: rec.firstSeen, p_path_keys: rec.pathKeys }), "putSeen");
    return data === true;
  }

  /**
   * Interface method (void). Same atomic statement as claimSeen. Residual race: the ingest pipeline does
   * getSeen() then putSeen(), so two serverless instances handling the same message at the same instant can
   * both observe "unseen" and both accept it. The damage is bounded: cases.id is the message id (primary key),
   * so only ONE case row exists (the second saveCase overwrites the first with the same content), and only
   * the `accepted` counter can over-count by one. Closing it fully needs the pipeline to branch on claimSeen().
   */
  async putSeen(id: string, rec: SeenRecord) {
    await this.claimSeen(id, rec);
  }

  // rate limiting ------------------------------------------------------------
  async recordSenderEvent(senderKey: string, at: number) {
    check(await this.db.from("sender_events").insert({ sender_key: senderKey, at }), "recordSenderEvent");
  }
  async countSenderEvents(senderKey: string, since: number) {
    const { count } = check(await this.db.from("sender_events").select("*", { count: "exact", head: true }).eq("sender_key", senderKey).gte("at", since), "countSenderEvents");
    return count ?? 0;
  }

  // revocation ---------------------------------------------------------------
  async isRevoked(senderKey: string) {
    const { data } = check(await this.db.from("revoked_identities").select("sender_key").eq("sender_key", senderKey).maybeSingle(), "isRevoked");
    return !!data;
  }
  async revoke(senderKey: string) {
    check(await this.db.from("revoked_identities").upsert({ sender_key: senderKey }, { onConflict: "sender_key", ignoreDuplicates: true }), "revoke");
  }

  // audio --------------------------------------------------------------------
  async addAudioFragment(parentId: string, senderKey: string, index: number, total: number, data: Uint8Array) {
    if (total < 1 || total > MAX_FRAGMENTS || index < 0 || index >= total) return null;

    // First writer defines owner and total; later fragments must match (first fragment wins, resends are ignored).
    check(
      await this.db.from("audio_fragments").upsert({ parent_id: parentId, idx: index, sender_key: senderKey, total, data: bytesToBase64(data) }, { onConflict: "parent_id,idx", ignoreDuplicates: true }),
      "addAudioFragment",
    );
    const { data: rows } = check(await this.db.from("audio_fragments").select("parent_id,idx,sender_key,total,data").eq("parent_id", parentId), "addAudioFragment");
    const frags = (rows ?? []) as FragmentRow[];
    if (frags.some((r) => r.sender_key !== senderKey || r.total !== total)) return null; // another identity / inconsistent total
    if (frags.length < total) return null;

    // Claim the whole set atomically: only the call whose DELETE returns every row assembles the audio,
    // so two instances finishing at the same time cannot both process it.
    const { data: claimed } = check(await this.db.from("audio_fragments").delete().eq("parent_id", parentId).select("idx,data"), "addAudioFragment");
    if (!claimed || claimed.length < total) return null;
    return assembleFragments(claimed as Pick<FragmentRow, "idx" | "data">[], total);
  }

  // rejections + metrics -----------------------------------------------------
  async logRejection(r: Rejection) {
    check(await this.db.from("rejections").insert(rejectionToRow(r)), "logRejection");
  }
  async listRejections() {
    const { data } = check(await this.db.from("rejections").select("at,reason,msg_id").order("id", { ascending: false }).limit(REJECTION_LIMIT), "listRejections");
    return ((data ?? []) as RejectionRow[]).map(rowToRejection).reverse(); // oldest first, like MemoryRepository
  }
  async getMetrics() {
    const { data } = check(await this.db.from("metrics").select("key,value"), "getMetrics");
    return rowsToMetrics((data ?? []) as MetricRow[]);
  }
  async bumpMetric(key: keyof Metrics, by = 1) {
    if (!METRIC_KEYS.includes(key)) throw new Error(`Unknown metric: ${String(key)}`);
    check(await this.db.rpc("bump_metric", { p_key: key, p_by: by }), "bumpMetric");
  }

  // seismic events -----------------------------------------------------------
  async getEvents() {
    const { data } = check(await this.db.from("seismic_events").select("*").order("id"), "getEvents");
    return ((data ?? []) as EventRow[]).map(rowToEvent);
  }
  async setEvents(events: EarthquakeEvent[]) {
    check(await this.db.from("seismic_events").delete().neq("id", ""), "setEvents");
    if (events.length) check(await this.db.from("seismic_events").insert(events.map(eventToRow)), "setEvents");
  }

  async reset() {
    check(await this.db.rpc("reset_all"), "reset");
  }
}
