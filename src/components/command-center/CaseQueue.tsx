"use client";

import type { Case, Priority } from "@/lib/domain/types";
import { sortCases, type SortKey } from "@/lib/priority/queue";
import { TYPE_LABEL, fmtWait } from "@/lib/labels";
import { Badge, StateNotice } from "../ui";
import s from "./command-center.module.css";

export const PRIORITY_TONE: Record<Priority, "critical" | "inverse" | "default" | "muted"> = { P1: "critical", P2: "inverse", P3: "default", P4: "muted" };

interface Props {
  cases: Case[];
  now: number;
  sort: SortKey;
  onSort: (k: SortKey) => void;
  selectedId?: string;
  onSelect: (id: string) => void;
}

export default function CaseQueue({ cases, now, sort, onSort, selectedId, onSelect }: Props) {
  const ordered = sortCases(cases, sort, now);
  return (
    <section className={s.panel} aria-labelledby="queue-title">
      <div className={s.panelHead}>
        <h2 id="queue-title">Prioritized queue ({cases.length})</h2>
        <label>
          <span className="sr-only">Sort by</span>
          <select className={s.select} value={sort} onChange={(e) => onSort(e.target.value as SortKey)}>
            <option value="priority">Sort: priority</option>
            <option value="trust">Sort: confidence</option>
            <option value="wait">Sort: wait time</option>
          </select>
        </label>
      </div>
      {ordered.length === 0 ? (
        <div className={s.panelBody}><StateNotice kind="empty">No help requests yet. Send one from the citizen simulator or load the scenario.</StateNotice></div>
      ) : (
        <ul className={s.queue}>
          {ordered.map((c) => {
            const closed = c.status === "closed" || c.status === "false";
            return (
              <li key={c.id} className={closed ? s.dim : undefined}>
                <button className={s.row} aria-current={c.id === selectedId} onClick={() => onSelect(c.id)}>
                  <Badge tone={PRIORITY_TONE[c.priority]}>{c.priority}</Badge>
                  <span className={s.rowMain}>
                    <strong>{TYPE_LABEL[c.type]} · {c.count} ppl.</strong>
                    <span className={s.rowMeta}>
                      {c.triage?.trapped ? "Possible entrapment · " : ""}
                      {c.needsReview ? "Human review · " : ""}
                      {c.paths.length > 1 ? `${c.paths.length} paths` : "1 path"}
                    </span>
                  </span>
                  <span className={s.rowRight}>
                    Conf. {c.trust?.score ?? "–"}
                    <br />
                    {fmtWait(now - c.receivedAt)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
