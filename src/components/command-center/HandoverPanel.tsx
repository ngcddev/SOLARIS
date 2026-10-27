"use client";

import { SOURCE_LABEL } from "@/lib/labels";
import { Badge, Button, StateNotice } from "../ui";
import s from "./command-center.module.css";

export interface Handover {
  headline: string;
  summary: string[];
  risks: string[];
  nextActions: string[];
  source: keyof typeof SOURCE_LABEL;
  generatedAt: number;
  modeLabel: string;
}

/** Shift handover: a long-context situation report of the whole operation (Muse Wonder, on demand). */
export default function HandoverPanel({ report, loading, onGenerate }: { report?: Handover; loading: boolean; onGenerate: () => void }) {
  return (
    <section className={s.panel} aria-labelledby="handover-title">
      <div className={s.panelHead}>
        <h2 id="handover-title">Shift handover report</h2>
        <Button size="sm" onClick={onGenerate} disabled={loading}>{loading ? "Writing…" : "Generate report"}</Button>
      </div>
      <div className={`${s.panelBody} ${s.report}`}>
        {loading && <StateNotice kind="loading">Summarizing the operation…</StateNotice>}
        {!loading && !report && <StateNotice kind="empty">Generate a briefing for the incoming shift: counts, risks and next actions.</StateNotice>}
        {report && !loading && (
          <>
            <p><strong>{report.headline}</strong></p>
            <div className={s.verdict}>
              <Badge tone="muted">{SOURCE_LABEL[report.source]}</Badge>
              <span className={s.stepNote}>{new Date(report.generatedAt).toLocaleTimeString("en-US")}</span>
            </div>
            <h3 className={s.h3}>Summary</h3>
            <ul>{report.summary.map((t, i) => <li key={i}>{t}</li>)}</ul>
            <h3 className={s.h3}>Risks</h3>
            <ul>{report.risks.map((t, i) => <li key={i}>{t}</li>)}</ul>
            <h3 className={s.h3}>Next actions</h3>
            <ul>{report.nextActions.map((t, i) => <li key={i}>{t}</li>)}</ul>
            <p className={s.stepNote}>Written from live numbers. Decisions remain with the rescuers.</p>
          </>
        )}
      </div>
    </section>
  );
}
