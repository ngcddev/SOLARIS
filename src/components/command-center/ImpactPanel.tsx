import type { CommandState } from "@/lib/client/useCommandState";
import s from "./command-center.module.css";

/** Impact in numbers: who the queue is trying to reach and what the system saves. */
export default function ImpactPanel({ impact }: { impact?: CommandState["impact"] }) {
  const v = (n?: number, suffix = "") => (n === undefined ? "–" : `${n.toLocaleString("en-US")}${suffix}`);
  return (
    <dl className={s.impact} aria-label="Impact">
      <div className={s.impactItem}><dt>People in P1/P2 cases</dt><dd>{v(impact?.peopleAtRisk)}</dd></div>
      <div className={s.impactItem}>
        <dt>Critical without a team</dt>
        <dd className={impact && impact.criticalUnassigned > 0 ? s.critical : undefined}>{v(impact?.criticalUnassigned)}{impact && impact.criticalUnassigned > 0 ? ` · oldest ${impact.oldestP1WaitMin} min` : ""}</dd>
      </div>
      <div className={s.impactItem}><dt>P1/P2 coverage</dt><dd>{v(impact?.coveragePct, "%")}</dd></div>
      <div className={s.impactItem}><dt>Manual review avoided</dt><dd>{v(impact?.manualMinutesSaved, " min")}</dd></div>
      <div className={s.impactItem}><dt>Attacks blocked</dt><dd>{v(impact?.attacksBlocked)}</dd></div>
      <div className={s.impactItem}><dt>Needs human review</dt><dd>{v(impact?.flaggedForReview)}</dd></div>
    </dl>
  );
}
