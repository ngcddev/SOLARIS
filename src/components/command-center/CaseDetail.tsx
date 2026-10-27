"use client";

import { useState } from "react";
import type { Case, Team } from "@/lib/domain/types";
import { SOURCE_LABEL, STATUS_LABEL, TYPE_LABEL, WHO_LABEL } from "@/lib/labels";
import type { CaseAction } from "@/lib/server/service";
import { Badge, Button, StateNotice } from "../ui";
import { PRIORITY_TONE } from "./CaseQueue";
import s from "./command-center.module.css";

interface Props {
  c?: Case;
  teams: Team[];
  busy: boolean;
  onAction: (action: CaseAction, teamId?: string) => void;
  children?: React.ReactNode; // field photos block
}

export default function CaseDetail({ c, teams, busy, onAction, children }: Props) {
  const [teamId, setTeamId] = useState("");
  if (!c) {
    return (
      <section className={s.panel} aria-labelledby="detail-title">
        <div className={s.panelHead}><h2 id="detail-title">Case detail</h2></div>
        <div className={s.panelBody}><StateNotice kind="empty">Select a case on the map or in the queue.</StateNotice></div>
      </section>
    );
  }
  const free = teams.filter((t) => t.status === "available");
  const assigned = teams.find((t) => t.id === c.assignedTeamId);
  const closed = c.status === "closed" || c.status === "false";

  return (
    <section className={s.panel} aria-labelledby="detail-title">
      <div className={s.panelHead}>
        <h2 id="detail-title">Case {c.id.slice(0, 6)}</h2>
        <span>
          <Badge tone={PRIORITY_TONE[c.priority]}>{c.priority}</Badge> <Badge tone="muted">{STATUS_LABEL[c.status]}</Badge>
        </span>
      </div>
      <div className={s.panelBody}>
        {c.needsReview && <StateNotice kind="error">Low confidence: human review required. The case stays in the queue with reduced priority.</StateNotice>}

        <dl className={s.kv}>
          <dt>Emergency</dt><dd>{TYPE_LABEL[c.type]}</dd>
          <dt>People</dt><dd>{c.count} ({c.who.map((w) => WHO_LABEL[w]).join(", ") || "no data"})</dd>
          <dt>Location</dt><dd>{c.lat.toFixed(5)}, {c.lon.toFixed(5)}</dd>
          <dt>Sender</dt><dd>{c.senderId} (public key)</dd>
          <dt>Mesh paths</dt>
          <dd>{c.paths.length === 0 ? "—" : c.paths.map((p, i) => <div key={i}>{p.length ? p.join(" → ") : "direct"} ({p.length} hops)</div>)}</dd>
        </dl>

        {c.triage && (
          <div>
            <h3 className={s.h3}>Rationale for the rescuer · {SOURCE_LABEL[c.triage.source]}</h3>
            <p className={s.quote}>{c.triage.justification}</p>
          </div>
        )}

        {c.transcript && (
          <div>
            <h3 className={s.h3}>Audio transcript · {SOURCE_LABEL[c.transcript.source]}</h3>
            <p className={s.quote}>{c.transcript.text ? `“${c.transcript.text}”` : "No transcript available."}</p>
            {c.audio && <p className={s.rowMeta}>{c.audio.seconds} s of audio · theoretical Codec2 ~{c.audio.codec2TheoreticalBytes} bytes</p>}
          </div>
        )}

        {c.trust && (
          <div>
            <h3 className={s.h3}>Confidence {c.trust.score}/100</h3>
            {c.trust.signals.map((sig) => (
              <div key={sig.id} className={s.signal}>
                <span>{sig.label}</span>
                <span className={s.bar} role="img" aria-label={`${Math.round(sig.value * 100)} percent`}><span style={{ width: `${Math.round(sig.value * 100)}%` }} /></span>
                <span>{sig.weight ? `×${sig.weight}` : "bonus"}</span>
                <span className={s.detail}>{sig.detail}</span>
              </div>
            ))}
          </div>
        )}

        {children}

        <div>
          <h3 className={s.h3}>Rescuer actions</h3>
          <div className={s.actions}>
            <Button size="sm" disabled={busy || closed || c.status === "validated"} onClick={() => onAction("validate")}>Validate</Button>
            <Button size="sm" disabled={busy || c.status === "false"} onClick={() => onAction("false")}>Mark as false</Button>
            <Button size="sm" variant="primary" disabled={busy || c.status === "dispatched" || closed} onClick={() => onAction("dispatch")}>Dispatch</Button>
            <Button size="sm" disabled={busy || c.status === "closed"} onClick={() => onAction("close")}>Close</Button>
          </div>
          <div className={s.actions} style={{ marginTop: "var(--space-2)" }}>
            <label>
              <span className="sr-only">Team to assign</span>
              <select className={s.select} value={teamId} onChange={(e) => setTeamId(e.target.value)}>
                <option value="">{assigned ? `Assigned: ${assigned.name}` : "Choose team…"}</option>
                {free.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.size})</option>)}
              </select>
            </label>
            <Button size="sm" disabled={busy || !teamId || closed} onClick={() => { onAction("assign", teamId); setTeamId(""); }}>Assign team</Button>
          </div>
        </div>

        <div>
          <h3 className={s.h3}>History</h3>
          <ol className={s.timeline}>
            {c.events.map((e, i) => <li key={i}>{new Date(e.at).toLocaleTimeString("en-US")} · {e.note}</li>)}
          </ol>
        </div>
      </div>
    </section>
  );
}
