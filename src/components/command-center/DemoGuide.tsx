"use client";

import { useState } from "react";
import { Button } from "../ui";
import s from "./command-center.module.css";

export interface DemoStep {
  id: string;
  title: string;
  note: string;
  done: boolean;
  /** Optional one-click action that performs the step. */
  action?: { label: string; run: () => void; disabled?: boolean };
}

/** Guided walkthrough so the live demo never depends on memory: every step shows whether it is done. */
export default function DemoGuide({ steps, onReset }: { steps: DemoStep[]; onReset: () => void }) {
  const [open, setOpen] = useState(true);
  const done = steps.filter((x) => x.done).length;
  return (
    <section className={`${s.panel} ${s.guide}`} aria-labelledby="guide-title">
      <div className={s.panelHead}>
        <h2 id="guide-title">Demo guide · {done}/{steps.length}</h2>
        <span className={s.actions}>
          <Button size="sm" onClick={onReset}>Reset demo</Button>
          <Button size="sm" onClick={() => setOpen((o) => !o)} aria-expanded={open}>{open ? "Hide" : "Show"}</Button>
        </span>
      </div>
      {open && (
        <ol className={s.steps}>
          {steps.map((st, i) => (
            <li key={st.id} className={`${s.step} ${st.done ? s.stepDone : ""}`}>
              <span className={s.stepMark} aria-hidden="true">{st.done ? "✓" : i + 1}</span>
              <span>
                <strong>{st.title}</strong>
                <br />
                <span className={s.stepNote}>{st.note}{st.done ? " (done)" : ""}</span>
              </span>
              {st.action ? <Button size="sm" onClick={st.action.run} disabled={st.action.disabled}>{st.action.label}</Button> : <span />}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
