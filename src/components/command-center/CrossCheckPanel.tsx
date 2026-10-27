"use client";

import { useState } from "react";
import type { Case } from "@/lib/domain/types";
import { SOURCE_LABEL } from "@/lib/labels";
import { postJson } from "@/lib/client/useCommandState";
import { Badge, Button, StateNotice } from "../ui";
import s from "./command-center.module.css";

const TONE = { consistent: "inverse", contradictory: "critical", insufficient: "muted" } as const;

/** Multimodal consistency check: report + audio + field photos compared by Muse Wonder (on demand). */
export default function CrossCheckPanel({ c, onChanged }: { c: Case; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function run() {
    setBusy(true);
    setError(false);
    const res = await postJson(`/api/cases/${c.id}/cross-check`);
    if (!res.ok) setError(true);
    onChanged();
    setBusy(false);
  }

  return (
    <div className={s.report}>
      <h3 className={s.h3}>Multimodal cross-check</h3>
      <p className={s.rowMeta}>Compares the button report, the audio transcript and the field photos. It can raise or lower confidence; it never discards a case.</p>
      <div className={s.actions} style={{ margin: "var(--space-2) 0" }}>
        <Button size="sm" onClick={run} disabled={busy}>{busy ? "Checking…" : c.crossCheck ? "Run again" : "Cross-check with photos & audio"}</Button>
      </div>
      {error && <StateNotice kind="error">The cross-check could not be completed.</StateNotice>}
      {c.crossCheck && (
        <>
          <div className={s.verdict}>
            <Badge tone={TONE[c.crossCheck.verdict]}>{c.crossCheck.verdict}</Badge>
            <Badge tone="muted">{SOURCE_LABEL[c.crossCheck.source]}</Badge>
          </div>
          <ul>{c.crossCheck.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
        </>
      )}
    </div>
  );
}
