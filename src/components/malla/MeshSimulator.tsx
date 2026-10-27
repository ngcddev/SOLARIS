"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { cssVar } from "@/lib/labels";
import { BLE_RANGE_M, buildMesh, flood, type FloodResult } from "@/lib/mesh/graph";
import { CALI_BARRIOS, CALI_GATEWAYS } from "@/lib/scenario/geography";
import DynamicMap, { type MapCircle, type MapLine, type MapMarker } from "../map/DynamicMap";
import { Badge, Button } from "../ui";
import { Icon } from "../ui/Icon";
import s from "./mesh.module.css";

const STEP_MS = 650;

export default function MeshSimulator() {
  const mesh = useMemo(() => buildMesh(CALI_BARRIOS, CALI_GATEWAYS, { seed: 11, phonesPerCluster: 16 }), []);
  const [barrio, setBarrio] = useState(CALI_BARRIOS[1].name);
  const [range, setRange] = useState(BLE_RANGE_M);
  const [ttl, setTtl] = useState(10);
  const phones = mesh.phonesByCluster.get(barrio) ?? [];
  const [originId, setOriginId] = useState(phones[0]?.id ?? "");
  const [optedOut, setOptedOut] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<FloodResult | null>(null);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const cluster = CALI_BARRIOS.find((b) => b.name === barrio)!;
  const maxStep = result ? Math.max(0, ...result.hops.map((h) => h.step)) : 0;
  const origin = originId && phones.some((p) => p.id === originId) ? originId : phones[0]?.id ?? "";

  useEffect(() => {
    if (!playing) return;
    timer.current = setInterval(() => {
      setStep((x) => {
        if (x >= maxStep + 1) {
          setPlaying(false);
          return x;
        }
        return x + 1;
      });
    }, STEP_MS);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [playing, maxStep]);

  function send() {
    // Phones without permission simply do not take part in the mesh.
    const active = mesh.nodes.filter((n) => n.kind !== "phone" || n.id === origin || !optedOut.has(n.id));
    const r = flood(active, origin, ttl, range);
    setResult(r);
    setStep(0);
    setPlaying(true);
    setCounts((c) => {
      const next = { ...c };
      for (const id of r.relayed) next[id] = (next[id] ?? 0) + 1;
      return next;
    });
  }

  const shown = result ? result.hops.filter((h) => h.step <= step) : [];
  const reached = new Set(shown.map((h) => h.to));
  const suppressedShown = result ? result.suppressed.filter((x) => x.step <= step).length : 0;
  const lastRelay = [...shown].reverse().find((h) => !h.to.startsWith("gw-"));
  const lastRelayId = lastRelay?.to;
  const byId = useMemo(() => new Map(mesh.nodes.map((n) => [n.id, n])), [mesh]);

  const markers: MapMarker[] = mesh.nodes.map((n) => {
    const isOrigin = n.id === origin;
    const got = reached.has(n.id);
    const out = n.kind === "phone" && optedOut.has(n.id);
    return {
      id: n.id,
      lat: n.lat,
      lon: n.lon,
      color: isOrigin ? cssVar("--color-accent-critical") : n.kind === "phone" ? cssVar("--color-node") : cssVar("--color-team"),
      radius: n.kind === "gateway" ? 10 : n.kind === "lora" ? 8 : 6,
      filled: isOrigin || got || n.kind === "gateway",
      label: `${n.id}${out ? " (sin permiso)" : ""}${counts[n.id] ? ` · retransmitió ${counts[n.id]}` : ""}`,
      selected: n.id === lastRelayId,
    };
  });
  const lines: MapLine[] = shown.map((h, i) => {
    const a = byId.get(h.from)!;
    const b = byId.get(h.to)!;
    return { id: `${h.from}-${h.to}-${i}`, points: [[a.lat, a.lon], [b.lat, b.lon]], color: cssVar("--color-text") };
  });
  const circles: MapCircle[] = origin && byId.get(origin) ? [{ id: "range", lat: byId.get(origin)!.lat, lon: byId.get(origin)!.lon, radiusM: range, color: cssVar("--color-text"), opacity: 0.08 }] : [];

  const delivered = result && step > maxStep ? result.deliveries : [];

  return (
    <div className={s.page}>
      <header className={s.top}>
        <h1>Solaris · Simulador de malla</h1>
        <Link href="/">Inicio</Link>
        <Link href="/centro">Centro de mando</Link>
        <Link href="/ciudadano">Simulador ciudadano</Link>
        <Badge tone="muted">Simulación visual: la malla BLE/LoRa real está en la hoja de ruta</Badge>
      </header>
      <main className={s.body}>
        <div className={s.col}>
          <div className={s.mapBox}>
            <DynamicMap center={[cluster.lat, cluster.lon]} zoom={17} markers={markers} lines={lines} circles={circles}
              onMarkerClick={(id) => { const n = byId.get(id); if (n?.kind === "phone") setOptedOut((cur) => { const x = new Set(cur); x.has(id) ? x.delete(id) : x.add(id); return x; }); }}
              ariaLabel="Mapa de la malla: teléfonos, nodos LoRa y pasarelas" />
          </div>
          <p className={s.hint}>Toca un teléfono para quitarle o darle el permiso de retransmitir. Círculo = alcance Bluetooth del emisor. Rojo = quien pide ayuda; negro = LoRa / pasarela.</p>
        </div>

        <div className={s.col}>
          <section className={s.panel} aria-labelledby="ctl">
            <div className={s.panelHead}><h2 id="ctl">Controles</h2></div>
            <div className={s.panelBody}>
              <label className={s.field}>Barrio
                <select className={s.select} value={barrio} onChange={(e) => { setBarrio(e.target.value); setOriginId(mesh.phonesByCluster.get(e.target.value)![0].id); setResult(null); }}>
                  {CALI_BARRIOS.map((b) => <option key={b.name}>{b.name}</option>)}
                </select><span />
              </label>
              <label className={s.field}>Emisor
                <select className={s.select} value={origin} onChange={(e) => { setOriginId(e.target.value); setResult(null); }}>
                  {phones.map((p) => <option key={p.id} value={p.id}>{p.id}</option>)}
                </select><span />
              </label>
              <label className={s.field}>Alcance BLE
                <input type="range" min={30} max={120} value={range} onChange={(e) => setRange(Number(e.target.value))} /><span>{range} m</span>
              </label>
              <label className={s.field}>TTL inicial
                <input type="range" min={2} max={14} value={ttl} onChange={(e) => setTtl(Number(e.target.value))} /><span>{ttl} saltos</span>
              </label>
              <div className={s.actions}>
                <Button variant="primary" onClick={send} disabled={playing}><Icon name="send" size={18} /> Enviar SOS simulado</Button>
                <Button onClick={() => { setResult(null); setStep(0); setCounts({}); }}>Reiniciar contadores</Button>
              </div>
            </div>
          </section>

          <section className={s.panel} aria-labelledby="res">
            <div className={s.panelHead}><h2 id="res">Resultado</h2></div>
            <div className={s.panelBody} aria-live="polite">
              <dl className={s.stats}>
                <div><dt>Nodos alcanzados</dt><dd>{reached.size}</dd></div>
                <div><dt>Copias descartadas (dedup)</dt><dd>{suppressedShown}</dd></div>
                <div><dt>Llegadas al centro</dt><dd>{delivered.length}</dd></div>
                <div><dt>Salto actual</dt><dd>{Math.min(step, maxStep)}/{maxStep}</dd></div>
              </dl>
              {result && result.deliveries.length === 0 && step > maxStep && <p className={s.hint}>El mensaje no llegó a ninguna pasarela: TTL agotado, alcance corto o teléfonos sin permiso.</p>}
              {delivered.map((d) => <p key={d.gateway} className={s.hint}>Camino a {d.gateway}: {d.path.join(" → ")} ({d.path.length} saltos)</p>)}
              <ol className={s.log} aria-label="Saltos">
                {shown.slice(-40).map((h, i) => <li key={i}>#{h.step} {h.from} → {h.to} · TTL {h.ttl}</li>)}
              </ol>
            </div>
          </section>

          <section className={s.panel} aria-labelledby="phone">
            <div className={s.panelHead}><h2 id="phone">Vista del teléfono que retransmite</h2></div>
            <div className={s.panelBody}>
              <div className={s.phone} role="status">
                <small>Solaris · ahora</small>
                <strong>Solaris está retransmitiendo SOS cercanos por Bluetooth</strong>
                <small>{lastRelayId ? `${lastRelayId}: Has retransmitido ${counts[lastRelayId] ?? 0} pedidos de ayuda` : "Aún no has retransmitido pedidos de ayuda"}</small>
              </div>
              <p className={s.hint}>Tu teléfono no puede leer los SOS que retransmite: viajan cifrados. Solo retransmite con permiso explícito y con esta notificación siempre visible.</p>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
