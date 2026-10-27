import type { Case, Priority, Team } from "../domain/types";
import { haversineM } from "../geo/geo";
import type { AnalystInput, AnalystOutput } from "../ai/types";

const RANK: Record<Priority, number> = { P1: 1, P2: 2, P3: 3, P4: 4 };
const FROM_RANK: Priority[] = ["P1", "P1", "P2", "P3", "P4"];

export type SortKey = "priority" | "trust" | "wait";

/** Low-confidence reports are demoted one level and flagged for review. They are never discarded. */
export function applyTrustToPriority(triaged: Priority, lowConfidence: boolean): { priority: Priority; needsReview: boolean } {
  if (!lowConfidence) return { priority: triaged, needsReview: false };
  return { priority: FROM_RANK[Math.min(4, RANK[triaged] + 1)], needsReview: true };
}

export function sortCases(cases: Case[], key: SortKey, now = Date.now()): Case[] {
  const prio = (c: Case) => RANK[c.priority];
  const trust = (c: Case) => c.trust?.score ?? 0;
  const wait = (c: Case) => now - c.receivedAt;
  const closedLast = (c: Case) => (c.status === "closed" || c.status === "false" ? 1 : 0);
  return [...cases].sort((a, b) => {
    const cl = closedLast(a) - closedLast(b);
    if (cl) return cl;
    if (key === "trust") return trust(b) - trust(a) || prio(a) - prio(b) || wait(b) - wait(a);
    if (key === "wait") return wait(b) - wait(a) || prio(a) - prio(b);
    return prio(a) - prio(b) || trust(b) - trust(a) || wait(b) - wait(a);
  });
}

/** Deterministic greedy baseline (also the level-3 fallback for the analyst): most urgent case gets the nearest free team. */
export function greedyAssignment(input: AnalystInput): AnalystOutput {
  const free = input.teams.filter((t) => t.status === "available");
  const used = new Set<string>();
  const ordered = [...input.cases].sort(
    (a, b) => RANK[a.priority] - RANK[b.priority] || b.trust - a.trust || b.waitMinutes - a.waitMinutes,
  );
  const assignments: AnalystOutput["assignments"] = [];
  for (const c of ordered) {
    const candidates = free
      .filter((t) => !used.has(t.id))
      .map((t) => ({ t, d: haversineM(t.lat, t.lon, c.lat, c.lon), fits: t.size >= Math.min(c.people, 4) }))
      .sort((x, y) => Number(y.fits) - Number(x.fits) || x.d - y.d);
    const best = candidates[0];
    if (!best) break;
    used.add(best.t.id);
    assignments.push({
      caseId: c.id,
      teamId: best.t.id,
      rationale: `${c.priority}: equipo disponible más cercano (${(best.d / 1000).toFixed(1)} km, ${best.t.size} integrantes). Sujeto a confirmación del brigadista.`,
    });
  }
  const unattended = ordered.length - assignments.length;
  return {
    assignments,
    notes: unattended > 0 ? `${unattended} caso(s) sin equipo disponible por ahora.` : "Todos los casos activos tienen una propuesta.",
  };
}

export function isActive(c: Case) {
  return c.status !== "closed" && c.status !== "false";
}

export function teamIsFree(t: Team) {
  return t.status === "available";
}
