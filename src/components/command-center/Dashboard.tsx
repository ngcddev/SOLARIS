"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { Case, Priority } from "@/lib/domain/types";
import { cssVar, SOURCE_LABEL, TYPE_LABEL } from "@/lib/labels";
import type { SortKey } from "@/lib/priority/queue";
import { postJson, useCommandState } from "@/lib/client/useCommandState";
import type { CaseAction } from "@/lib/server/service";
import DynamicMap, { type MapCircle, type MapMarker } from "../map/DynamicMap";
import { Badge, Button, StateNotice } from "../ui";
import CaseDetail from "./CaseDetail";
import CaseQueue from "./CaseQueue";
import FieldPhotos from "./FieldPhotos";
import s from "./command-center.module.css";

const CALI: [number, number] = [3.4516, -76.532];

interface Suggestion { caseId: string; teamId: string; rationale: string }
interface Recommendation { assignments: Suggestion[]; notes: string; source: keyof typeof SOURCE_LABEL; modeLabel: string }

export default function Dashboard() {
  const { data, error, refresh } = useCommandState();
  const [selectedId, setSelectedId] = useState<string>();
  const [sort, setSort] = useState<SortKey>("priority");
  const [density, setDensity] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string }>();
  const [rec, setRec] = useState<Recommendation>();
  const [recLoading, setRecLoading] = useState(false);
  const [scenarioBusy, setScenarioBusy] = useState(false);

  const cases = data?.cases ?? [];
  const selected = cases.find((c) => c.id === selectedId);

  const markers: MapMarker[] = useMemo(() => {
    const color: Record<Priority, string> = { P1: cssVar("--color-priority-1"), P2: cssVar("--color-priority-2"), P3: cssVar("--color-priority-3"), P4: cssVar("--color-priority-4") };
    const out: MapMarker[] = cases
      .filter((c) => c.status !== "closed")
      .map((c) => ({ id: c.id, lat: c.lat, lon: c.lon, color: color[c.priority], radius: c.priority === "P1" ? 9 : 7, selected: c.id === selectedId, filled: c.status !== "false", label: `${c.priority} · ${TYPE_LABEL[c.type]} (${c.count})` }));
    for (const t of data?.teams ?? []) out.push({ id: `team:${t.id}`, lat: t.lat, lon: t.lon, color: cssVar("--color-team"), radius: 5, filled: false, label: `${t.name} · ${t.status}` });
    return out;
  }, [cases, data?.teams, selectedId]);

  const circles: MapCircle[] = useMemo(() => {
    if (!density) return [];
    return cases.filter((c) => c.status !== "closed" && c.status !== "false").map((c) => ({ id: c.id, lat: c.lat, lon: c.lon, radiusM: 180, color: cssVar("--color-priority-1"), opacity: 0.12 }));
  }, [cases, density]);

  async function act(action: CaseAction, teamId?: string) {
    if (!selected) return;
    setBusy(true);
    const res = await postJson<{ ok: boolean; error?: string }>(`/api/cases/${selected.id}/action`, { action, teamId });
    setNotice(res.ok ? { kind: "success", text: "Action recorded." } : { kind: "error", text: res.data.error ?? "The action could not be completed." });
    await refresh();
    setBusy(false);
  }

  async function toggleOffline() {
    await postJson("/api/offline", { offline: !data?.offline });
    await refresh();
  }

  async function loadScenario() {
    setScenarioBusy(true);
    setNotice(undefined);
    setRec(undefined);
    setSelectedId(undefined);
    const res = await postJson<{ validSos: number; outcome: { duplicates: number; rejectedByReason: Record<string, number> } }>("/api/scenario", { action: "load" });
    if (res.ok) {
      const rej = Object.values(res.data.outcome.rejectedByReason).reduce((a, b) => a + b, 0);
      setNotice({ kind: "success", text: `Simulated scenario loaded: ${res.data.validSos} SOS, ${res.data.outcome.duplicates} duplicates merged, ${rej} attempts rejected. Fictional earthquake.` });
    } else setNotice({ kind: "error", text: "The scenario could not be loaded." });
    await refresh();
    setScenarioBusy(false);
  }

  async function benchmark() {
    setScenarioBusy(true);
    const res = await postJson<{ count: number; mode: string; totalMs: number; perSosMs: number; manualMinutes: number; speedup: number }>("/api/scenario", { action: "benchmark" });
    if (res.ok) {
      const b = res.data;
      setNotice({ kind: "success", text: `Benchmark: ${b.count} SOS prioritized in ${b.totalMs} ms (${b.perSosMs} ms/SOS, ${b.mode} mode). Estimated manual review: ${b.manualMinutes} min (2 min per SOS, assumption) → ~${b.speedup.toLocaleString("en-US")}x faster.` });
    } else setNotice({ kind: "error", text: "The benchmark could not be run." });
    setScenarioBusy(false);
  }

  async function recommend() {
    setRecLoading(true);
    setNotice(undefined);
    const res = await postJson<Recommendation>("/api/recommend");
    if (res.ok) setRec(res.data);
    else setNotice({ kind: "error", text: "The recommendation could not be generated." });
    setRecLoading(false);
  }

  async function decide(sug: Suggestion, accept: boolean) {
    if (accept) {
      const res = await postJson<{ error?: string }>(`/api/cases/${sug.caseId}/action`, { action: "assign", teamId: sug.teamId });
      setNotice(res.ok ? { kind: "success", text: "Suggestion accepted: team assigned." } : { kind: "error", text: res.data.error ?? "The team could not be assigned." });
    }
    setRec((r) => r && { ...r, assignments: r.assignments.filter((a) => a !== sug) });
    await refresh();
  }

  const m = data?.metrics;
  const activeCases = cases.filter((c) => c.status !== "closed" && c.status !== "false");

  return (
    <div className={s.page}>
      <header className={s.top}>
        <div className={s.brand}>
          <h1>Solaris · Command center</h1>
          <Link href="/">Home</Link>
          <Link href="/citizen">Citizen simulator</Link>
          <Link href="/mesh">Mesh</Link>
        </div>
        <div className={s.controls}>
          <Badge tone={data?.mode === "rules" ? "critical" : data?.mode === "meta" ? "inverse" : "default"} title="Active AI mode">
            <span className={s.mode}>{data?.modeLabel ?? "…"}</span>
          </Badge>
          <Button size="sm" onClick={loadScenario} disabled={scenarioBusy}>{scenarioBusy ? "Loading…" : "Load Cali 2026 scenario"}</Button>
          <Button size="sm" onClick={benchmark} disabled={scenarioBusy}>Benchmark 100 SOS</Button>
          <Button size="sm" selected={!!data?.offline} onClick={toggleOffline} disabled={!data}>Simulate internet outage</Button>
        </div>
      </header>

      <dl className={s.metrics} aria-label="Live metrics">
        <div className={s.metric}><dt>SOS received</dt><dd>{m?.received ?? "–"}</dd></div>
        <div className={s.metric}><dt>Prioritized</dt><dd>{m?.prioritized ?? "–"}</dd></div>
        <div className={s.metric}><dt>Average triage</dt><dd>{m ? `${m.avgTriageMs} ms` : "–"}</dd></div>
        <div className={s.metric}><dt>Duplicates blocked</dt><dd>{m?.duplicates ?? "–"}</dd></div>
        <div className={s.metric}><dt>Replays blocked</dt><dd>{m?.replaysBlocked ?? "–"}</dd></div>
        <div className={s.metric}><dt>Rejected</dt><dd>{m?.rejected ?? "–"}</dd></div>
      </dl>

      {!data && !error && <div style={{ padding: "var(--space-4)" }}><StateNotice kind="loading">Connecting to the command center…</StateNotice></div>}
      {error && <div style={{ padding: "var(--space-4)" }}><StateNotice kind="error">No connection to the server. Retrying… (the data shown may be out of date)</StateNotice></div>}
      {data?.degradations.length ? <div style={{ padding: "0 var(--space-4)", paddingTop: "var(--space-3)" }}><StateNotice kind="error">The AI failed ({data.degradations.at(-1)?.stage}); the system continued with rules.</StateNotice></div> : null}
      {notice && <div style={{ padding: "var(--space-3) var(--space-4) 0" }}><StateNotice kind={notice.kind}>{notice.text}</StateNotice></div>}

      {data && (
        <main className={s.body}>
          <div className={s.col}>
            <section className={s.panel} aria-labelledby="map-title">
              <div className={s.panelHead}>
                <h2 id="map-title">Map ({activeCases.length} active)</h2>
                <Button size="sm" selected={density} onClick={() => setDensity((d) => !d)}>Density</Button>
              </div>
              <div className={s.panelBody}>
                <div className={s.mapBox}>
                  <DynamicMap center={selected ? [selected.lat, selected.lon] : CALI} zoom={13} markers={markers} circles={circles}
                    onMarkerClick={(id) => !id.startsWith("team:") && setSelectedId(id)} ariaLabel="Map of help requests by priority" />
                </div>
                <div className={s.legend} aria-label="Legend">
                  {(["P1", "P2", "P3", "P4"] as Priority[]).map((p, i) => <span key={p}><span className={s.dot} style={{ background: `var(--color-priority-${i + 1})` }} />{p}</span>)}
                  <span><span className={s.dot} style={{ background: "transparent" }} />Team / false</span>
                </div>
              </div>
            </section>
            <CaseQueue cases={cases as Case[]} now={data.now} sort={sort} onSort={setSort} selectedId={selectedId} onSelect={setSelectedId} />
          </div>

          <div className={s.col}>
            <CaseDetail c={selected as Case | undefined} teams={data.teams} busy={busy} onAction={act}>
              {selected && <FieldPhotos c={selected as Case} onChanged={refresh} />}
            </CaseDetail>

            <section className={s.panel} aria-labelledby="teams-title">
              <div className={s.panelHead}>
                <h2 id="teams-title">Rescue teams</h2>
                <Button size="sm" variant="primary" onClick={recommend} disabled={recLoading || activeCases.length === 0}>{recLoading ? "Analyzing…" : "Recommend assignment"}</Button>
              </div>
              <ul className={s.teams}>
                {data.teams.map((t) => (
                  <li key={t.id}><span>{t.name} · {t.size} members</span><Badge tone={t.status === "available" ? "default" : "inverse"}>{t.status === "available" ? "Available" : t.status === "assigned" ? "Assigned" : "Dispatched"}</Badge></li>
                ))}
              </ul>
              {(rec || recLoading) && (
                <div className={s.panelBody}>
                  {recLoading && <StateNotice kind="loading">Calculating assignment proposal…</StateNotice>}
                  {rec && (
                    <>
                      <p className={s.rowMeta}>AI proposal ({SOURCE_LABEL[rec.source]}). AI suggests; you decide: accept or reject each one. {rec.notes}</p>
                      {rec.assignments.length === 0 && <StateNotice kind="empty">No suggestions left pending.</StateNotice>}
                      {rec.assignments.map((a) => {
                        const c = cases.find((x) => x.id === a.caseId);
                        const t = data.teams.find((x) => x.id === a.teamId);
                        return (
                          <div key={a.caseId} className={s.suggestion}>
                            <strong>{c ? `${c.priority} · ${TYPE_LABEL[c.type]} (${c.count})` : a.caseId.slice(0, 6)} → {t?.name ?? a.teamId}</strong>
                            <span>{a.rationale}</span>
                            <span className={s.actions}>
                              <Button size="sm" variant="primary" onClick={() => decide(a, true)}>Accept</Button>
                              <Button size="sm" onClick={() => decide(a, false)}>Reject</Button>
                            </span>
                          </div>
                        );
                      })}
                    </>
                  )}
                </div>
              )}
            </section>

            <section className={s.panel} aria-labelledby="def-title">
              <div className={s.panelHead}><h2 id="def-title">Active defenses</h2></div>
              <div className={s.panelBody}>
                {data.rejections.length === 0 ? (
                  <StateNotice kind="empty">No rejected attempts.</StateNotice>
                ) : (
                  <ul className={s.log}>
                    {data.rejections.slice(0, 8).map((r, i) => <li key={i}>{new Date(r.at).toLocaleTimeString("en-US")} · {r.reason}{r.id ? ` · ${r.id.slice(0, 6)}` : ""}</li>)}
                  </ul>
                )}
              </div>
            </section>
          </div>
        </main>
      )}
    </div>
  );
}
