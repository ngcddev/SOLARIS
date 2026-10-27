import type { PhotoFinding, Priority } from "../domain/types";
import type { EmergencyType } from "../packet/types";
import { containsMedicalAdvice, SAFE_FALLBACK_JUSTIFICATION } from "./safety";

/**
 * Deterministic, rules-based versions of the two "analyst" tasks. They are the mock implementation
 * AND the graceful-degradation fallback when Muse Wonder is unavailable or returns invalid output.
 */

export interface CrossCheckInput {
  report: {
    type: EmergencyType;
    reportedPeople: number;
    trapped: boolean;
    hasBabies: boolean;
    transcript?: string;
    /** Coherence of the report as judged by triage (0..1). */
    coherence: number;
  };
  photos: { findings: PhotoFinding[] }[];
}

export interface CrossCheckOutput {
  verdict: "consistent" | "contradictory" | "insufficient";
  reasons: string[];
}

const sumFor = (photos: CrossCheckInput["photos"], phrase: string) =>
  photos.reduce((n, p) => n + (p.findings.find((f) => f.phrase === phrase)?.count ?? 0), 0);

export function crossCheckByRules(input: CrossCheckInput): CrossCheckOutput {
  const { report, photos } = input;
  const reasons: string[] = [];
  if (report.coherence < 0.3) reasons.push("The audio/text of the report looks incoherent or like a joke.");
  if (photos.length === 0) {
    reasons.push("No field photo has been attached yet, so the report cannot be checked against imagery.");
    return { verdict: report.coherence < 0.3 ? "contradictory" : "insufficient", reasons };
  }
  const people = sumFor(photos, "person");
  const collapsed = sumFor(photos, "collapsed structure");
  const blocked = sumFor(photos, "blocked road");

  let contradictory = report.coherence < 0.3;
  if (people === 0 && collapsed === 0) {
    reasons.push("Field imagery shows no people and no collapsed structure at the reported location.");
    contradictory = true;
  } else {
    reasons.push(`Field imagery shows ${people} person(s) and ${collapsed} collapsed structure(s)${blocked ? ` and ${blocked} blocked road segment(s)` : ""}.`);
    if (report.trapped && collapsed > 0) reasons.push("A collapsed structure supports the reported entrapment.");
    if (report.reportedPeople > 0 && people > 0 && people < Math.ceil(report.reportedPeople / 2)) {
      reasons.push(`Fewer people are visible (${people}) than reported (${report.reportedPeople}); some may be out of frame.`);
    }
    if (blocked > 0) reasons.push("Blocked access: plan an alternative route for the rescue team.");
  }
  const text = reasons.join(" ");
  return { verdict: contradictory ? "contradictory" : "consistent", reasons: containsMedicalAdvice(text) ? [SAFE_FALLBACK_JUSTIFICATION] : reasons };
}

export interface HandoverInput {
  generatedAt: number;
  activeByPriority: Record<Priority, number>;
  oldestP1WaitMin: number;
  unassignedP1: number;
  flaggedForReview: number;
  teams: { total: number; available: number; assigned: number; dispatched: number };
  defenses: { duplicatesMerged: number; replaysBlocked: number; rejected: number };
  contradictoryCrossChecks: number;
  photos: number;
  top: { id: string; priority: Priority; type: EmergencyType; people: number; waitMin: number; assigned: boolean }[];
}

export interface HandoverOutput {
  headline: string;
  summary: string[];
  risks: string[];
  nextActions: string[];
}

export function handoverByRules(i: HandoverInput): HandoverOutput {
  const a = i.activeByPriority;
  const active = a.P1 + a.P2 + a.P3 + a.P4;
  const summary = [
    `${active} active case(s): P1 ${a.P1}, P2 ${a.P2}, P3 ${a.P3}, P4 ${a.P4}.`,
    `Teams: ${i.teams.available} available, ${i.teams.assigned} assigned, ${i.teams.dispatched} dispatched (of ${i.teams.total}).`,
    `Defenses: ${i.defenses.duplicatesMerged} duplicate path(s) merged, ${i.defenses.replaysBlocked} replay(s) blocked, ${i.defenses.rejected} packet(s) rejected.`,
  ];
  if (i.photos) summary.push(`${i.photos} field photo(s) analyzed.`);

  const risks: string[] = [];
  if (i.unassignedP1 > 0) risks.push(`${i.unassignedP1} critical (P1) case(s) still have no team; the oldest has waited ${i.oldestP1WaitMin} min.`);
  if (i.teams.available === 0 && active > 0) risks.push("No team is available: new cases will queue until a team is freed.");
  if (i.flaggedForReview > 0) risks.push(`${i.flaggedForReview} low-confidence case(s) need human review; they were demoted, not discarded.`);
  if (i.contradictoryCrossChecks > 0) risks.push(`${i.contradictoryCrossChecks} case(s) have field imagery that contradicts the report.`);
  if (risks.length === 0) risks.push("No critical risks detected from the current data.");

  const next: string[] = [];
  if (i.unassignedP1 > 0 && i.teams.available > 0) next.push("Run 'Recommend assignment' and review the P1 suggestions first.");
  if (i.flaggedForReview > 0) next.push("Review the flagged low-confidence cases and validate or mark them as false.");
  if (i.contradictoryCrossChecks > 0) next.push("Re-check the contradicting cases with a second source before dispatching.");
  if (a.P1 + a.P2 > 0 && i.photos === 0) next.push("Request field photos from rescuers or drones for the highest-priority cases.");
  if (next.length === 0) next.push("Keep monitoring the queue.");

  const top = i.top.slice(0, 3).map((t) => `${t.priority} ${t.type} (${t.people} ppl, ${t.waitMin} min${t.assigned ? ", team assigned" : ""})`).join("; ");
  return {
    headline: `Shift handover: ${active} active, ${a.P1} critical, ${i.unassignedP1} critical without a team.${top ? ` Top: ${top}.` : ""}`,
    summary,
    risks,
    nextActions: next,
  };
}
