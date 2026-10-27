import type { HandoverInput } from "./ai/reports";
import type { Case, Metrics, Priority, Team } from "./domain/types";
import { isActive } from "./priority/queue";

/** Estimated minutes a human needs to read, locate and rank one SOS by hand (assumption, see docs/ASSUMPTIONS.md). */
export const MANUAL_MINUTES_PER_SOS = 2;

export interface Impact {
  activeCases: number;
  /** People in active P1/P2 cases: who the queue is trying to reach first. */
  peopleAtRisk: number;
  criticalUnassigned: number;
  oldestP1WaitMin: number;
  /** Manual review time avoided, in minutes (prioritized x 2 min, minus machine time). */
  manualMinutesSaved: number;
  /** Replays + malformed/forged/revoked/rate-limited packets stopped before reaching the queue. */
  attacksBlocked: number;
  duplicatesMerged: number;
  flaggedForReview: number;
  /** Share of active P1/P2 cases that already have a team assigned or dispatched (0..100). */
  coveragePct: number;
}

const hasTeam = (c: Case) => c.status === "assigned" || c.status === "dispatched";

export function computeImpact(cases: Case[], metrics: Metrics, avgTriageMs: number, now: number): Impact {
  const active = cases.filter(isActive);
  const urgent = active.filter((c) => c.priority === "P1" || c.priority === "P2");
  const p1 = active.filter((c) => c.priority === "P1");
  const unassignedP1 = p1.filter((c) => !hasTeam(c));
  const prioritized = cases.filter((c) => c.triage).length;
  const machineMin = (prioritized * avgTriageMs) / 60000;
  return {
    activeCases: active.length,
    peopleAtRisk: urgent.reduce((n, c) => n + (c.triage?.people ?? c.count), 0),
    criticalUnassigned: unassignedP1.length,
    oldestP1WaitMin: Math.round(Math.max(0, ...unassignedP1.map((c) => (now - c.receivedAt) / 60000))),
    manualMinutesSaved: Math.max(0, Math.round(prioritized * MANUAL_MINUTES_PER_SOS - machineMin)),
    attacksBlocked: metrics.replaysBlocked + metrics.rejected,
    duplicatesMerged: metrics.duplicates,
    flaggedForReview: active.filter((c) => c.needsReview).length,
    coveragePct: urgent.length ? Math.round((urgent.filter(hasTeam).length / urgent.length) * 100) : 0,
  };
}

/** Compact, number-only snapshot of the operation: the input of the shift-handover report. */
export function buildHandoverInput(cases: Case[], teams: Team[], metrics: Metrics, now: number): HandoverInput {
  const active = cases.filter(isActive);
  const byP: Record<Priority, number> = { P1: 0, P2: 0, P3: 0, P4: 0 };
  active.forEach((c) => byP[c.priority]++);
  const impact = computeImpact(cases, metrics, 0, now);
  const rank = { P1: 1, P2: 2, P3: 3, P4: 4 } as const;
  const top = [...active]
    .sort((a, b) => rank[a.priority] - rank[b.priority] || a.receivedAt - b.receivedAt)
    .slice(0, 5)
    .map((c) => ({ id: c.id, priority: c.priority, type: c.type, people: c.triage?.people ?? c.count, waitMin: Math.round((now - c.receivedAt) / 60000), assigned: hasTeam(c) }));
  return {
    generatedAt: now,
    activeByPriority: byP,
    oldestP1WaitMin: impact.oldestP1WaitMin,
    unassignedP1: impact.criticalUnassigned,
    flaggedForReview: impact.flaggedForReview,
    teams: {
      total: teams.length,
      available: teams.filter((t) => t.status === "available").length,
      assigned: teams.filter((t) => t.status === "assigned").length,
      dispatched: teams.filter((t) => t.status === "dispatched").length,
    },
    defenses: { duplicatesMerged: metrics.duplicates, replaysBlocked: metrics.replaysBlocked, rejected: metrics.rejected },
    contradictoryCrossChecks: active.filter((c) => c.crossCheck?.verdict === "contradictory").length,
    photos: cases.reduce((n, c) => n + c.photos.length, 0),
    top,
  };
}
