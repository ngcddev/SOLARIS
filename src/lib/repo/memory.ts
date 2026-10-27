import type { Case, EarthquakeEvent, Metrics, Rejection, Team } from "../domain/types";
import type { Repository, SeenRecord } from "./Repository";

const emptyMetrics = (): Metrics => ({ received: 0, accepted: 0, duplicates: 0, replaysBlocked: 0, rejected: 0 });
const MAX_FRAGMENTS = 16;

export class MemoryRepository implements Repository {
  private cases = new Map<string, Case>();
  private teams = new Map<string, Team>();
  private seen = new Map<string, SeenRecord>();
  private senderEvents = new Map<string, number[]>();
  private revoked = new Set<string>();
  private fragments = new Map<string, { senderKey: string; total: number; parts: Map<number, Uint8Array> }>();
  private rejections: Rejection[] = [];
  private metrics = emptyMetrics();
  private events: EarthquakeEvent[] = [];

  async getCase(id: string) { return this.cases.get(id); }
  async saveCase(c: Case) { this.cases.set(c.id, c); }
  async listCases() { return [...this.cases.values()]; }

  async listTeams() { return [...this.teams.values()]; }
  async saveTeam(t: Team) { this.teams.set(t.id, t); }

  async getSeen(id: string) { return this.seen.get(id); }
  async putSeen(id: string, rec: SeenRecord) { this.seen.set(id, rec); }

  async recordSenderEvent(senderKey: string, at: number) {
    const list = this.senderEvents.get(senderKey) ?? [];
    list.push(at);
    this.senderEvents.set(senderKey, list);
  }
  async countSenderEvents(senderKey: string, since: number) {
    return (this.senderEvents.get(senderKey) ?? []).filter((t) => t >= since).length;
  }

  async isRevoked(senderKey: string) { return this.revoked.has(senderKey); }
  async revoke(senderKey: string) { this.revoked.add(senderKey); }

  async addAudioFragment(parentId: string, senderKey: string, index: number, total: number, data: Uint8Array) {
    if (total < 1 || total > MAX_FRAGMENTS || index >= total) return null;
    let entry = this.fragments.get(parentId);
    if (!entry) {
      entry = { senderKey, total, parts: new Map() };
      this.fragments.set(parentId, entry);
    }
    // Only the identity that started the audio may add fragments to it.
    if (entry.senderKey !== senderKey || entry.total !== total) return null;
    entry.parts.set(index, data);
    if (entry.parts.size < total) return null;
    const ordered = [...Array(total).keys()].map((i) => entry!.parts.get(i)!);
    const out = new Uint8Array(ordered.reduce((n, p) => n + p.length, 0));
    let off = 0;
    for (const p of ordered) { out.set(p, off); off += p.length; }
    this.fragments.delete(parentId);
    return out;
  }

  async logRejection(r: Rejection) {
    this.rejections.push(r);
    if (this.rejections.length > 500) this.rejections.shift();
  }
  async listRejections() { return [...this.rejections]; }

  async getMetrics() { return { ...this.metrics }; }
  async bumpMetric(key: keyof Metrics, by = 1) { this.metrics[key] += by; }

  async getEvents() { return [...this.events]; }
  async setEvents(e: EarthquakeEvent[]) { this.events = e; }

  async reset() {
    this.cases.clear(); this.teams.clear(); this.seen.clear(); this.senderEvents.clear();
    this.revoked.clear(); this.fragments.clear(); this.rejections = [];
    this.metrics = emptyMetrics(); this.events = [];
  }
}

const g = globalThis as unknown as { __solarisRepo?: Repository };

/** Singleton that survives Next.js HMR/module reloads in dev. */
export function getRepository(): Repository {
  g.__solarisRepo ??= new MemoryRepository();
  return g.__solarisRepo;
}
