"use client";

import { useState } from "react";
import type { Case, Team } from "@/lib/domain/types";
import { SOURCE_LABEL, STATUS_LABEL, TYPE_LABEL, WHO_LABEL } from "@/lib/labels";
import type { CaseAction } from "@/lib/server/service";
import { Badge, Button, StateNotice } from "../ui";
import { PRIORITY_TONE } from "./CaseQueue";
import s from "./centro.module.css";

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
        <div className={s.panelHead}><h2 id="detail-title">Detalle del caso</h2></div>
        <div className={s.panelBody}><StateNotice kind="empty">Selecciona un caso en el mapa o en la cola.</StateNotice></div>
      </section>
    );
  }
  const free = teams.filter((t) => t.status === "available");
  const assigned = teams.find((t) => t.id === c.assignedTeamId);
  const closed = c.status === "closed" || c.status === "false";

  return (
    <section className={s.panel} aria-labelledby="detail-title">
      <div className={s.panelHead}>
        <h2 id="detail-title">Caso {c.id.slice(0, 6)}</h2>
        <span>
          <Badge tone={PRIORITY_TONE[c.priority]}>{c.priority}</Badge> <Badge tone="muted">{STATUS_LABEL[c.status]}</Badge>
        </span>
      </div>
      <div className={s.panelBody}>
        {c.needsReview && <StateNotice kind="error">Confianza baja: revisión humana requerida. El caso sigue en la cola con prioridad reducida.</StateNotice>}

        <dl className={s.kv}>
          <dt>Emergencia</dt><dd>{TYPE_LABEL[c.type]}</dd>
          <dt>Personas</dt><dd>{c.count} ({c.who.map((w) => WHO_LABEL[w]).join(", ") || "sin dato"})</dd>
          <dt>Ubicación</dt><dd>{c.lat.toFixed(5)}, {c.lon.toFixed(5)}</dd>
          <dt>Remitente</dt><dd>{c.senderId} (llave pública)</dd>
          <dt>Caminos malla</dt>
          <dd>{c.paths.length === 0 ? "—" : c.paths.map((p, i) => <div key={i}>{p.length ? p.join(" → ") : "directo"} ({p.length} saltos)</div>)}</dd>
        </dl>

        {c.triage && (
          <div>
            <h3 className={s.h3}>Justificación para el rescatista · {SOURCE_LABEL[c.triage.source]}</h3>
            <p className={s.quote}>{c.triage.justification}</p>
          </div>
        )}

        {c.transcript && (
          <div>
            <h3 className={s.h3}>Transcripción de audio · {SOURCE_LABEL[c.transcript.source]}</h3>
            <p className={s.quote}>{c.transcript.text ? `“${c.transcript.text}”` : "Sin transcripción disponible."}</p>
            {c.audio && <p className={s.rowMeta}>Audio de {c.audio.seconds} s · Codec2 teórico ~{c.audio.codec2TheoreticalBytes} bytes</p>}
          </div>
        )}

        {c.trust && (
          <div>
            <h3 className={s.h3}>Confianza {c.trust.score}/100</h3>
            {c.trust.signals.map((sig) => (
              <div key={sig.id} className={s.signal}>
                <span>{sig.label}</span>
                <span className={s.bar} role="img" aria-label={`${Math.round(sig.value * 100)} por ciento`}><span style={{ width: `${Math.round(sig.value * 100)}%` }} /></span>
                <span>{sig.weight ? `×${sig.weight}` : "bonus"}</span>
                <span className={s.detail}>{sig.detail}</span>
              </div>
            ))}
          </div>
        )}

        {children}

        <div>
          <h3 className={s.h3}>Acciones del brigadista</h3>
          <div className={s.actions}>
            <Button size="sm" disabled={busy || closed || c.status === "validated"} onClick={() => onAction("validate")}>Validar</Button>
            <Button size="sm" disabled={busy || c.status === "false"} onClick={() => onAction("false")}>Marcar como falso</Button>
            <Button size="sm" variant="primary" disabled={busy || c.status === "dispatched" || closed} onClick={() => onAction("dispatch")}>Despachar</Button>
            <Button size="sm" disabled={busy || c.status === "closed"} onClick={() => onAction("close")}>Cerrar</Button>
          </div>
          <div className={s.actions} style={{ marginTop: "var(--space-2)" }}>
            <label>
              <span className="sr-only">Equipo a asignar</span>
              <select className={s.select} value={teamId} onChange={(e) => setTeamId(e.target.value)}>
                <option value="">{assigned ? `Asignado: ${assigned.name}` : "Elegir equipo…"}</option>
                {free.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.size})</option>)}
              </select>
            </label>
            <Button size="sm" disabled={busy || !teamId || closed} onClick={() => { onAction("assign", teamId); setTeamId(""); }}>Asignar equipo</Button>
          </div>
        </div>

        <div>
          <h3 className={s.h3}>Historial</h3>
          <ol className={s.timeline}>
            {c.events.map((e, i) => <li key={i}>{new Date(e.at).toLocaleTimeString("es-CO")} · {e.note}</li>)}
          </ol>
        </div>
      </div>
    </section>
  );
}
