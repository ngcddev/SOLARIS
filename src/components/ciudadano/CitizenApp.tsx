"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {

  MAX_SOS_PACKET_BYTES,
  buildAudioPacket,
  buildSosPacket,
  fromBase64,
  initCrypto,
  randomBytes,
  toBase64,
  type EmergencyType,
  type WhoKind,
} from "@/lib/packet";
import { loadIdentity } from "@/lib/client/identity";
import { startRecording, type Recording } from "@/lib/client/wav";
import DynamicMap from "../map/DynamicMap";
import { Badge, Button, StateNotice } from "../ui";
import { Icon, type IconName } from "../ui/Icon";
import s from "./citizen.module.css";

const MAX_AUDIO_S = 15;
const CODEC2_BPS = 1200;
const AUDIO_CHUNK = 60_000;

const TYPES: { id: EmergencyType; label: string }[] = [
  { id: "trapped", label: "Atrapado" },
  { id: "injured", label: "Herido" },
  { id: "bleeding", label: "Sangrado" },
  { id: "fire", label: "Incendio" },
  { id: "other", label: "Otro" },
];
const WHO: { id: WhoKind; label: string }[] = [
  { id: "baby", label: "Bebé" },
  { id: "child", label: "Niño" },
  { id: "adult", label: "Adulto" },
  { id: "elder", label: "Adulto mayor" },
];
const PLACES = [
  { name: "Centro de Cali", lat: 3.4516, lon: -76.532 },
  { name: "San Antonio", lat: 3.4505, lon: -76.5385 },
  { name: "El Peñón", lat: 3.4545, lon: -76.542 },
  { name: "Granada", lat: 3.465, lon: -76.533 },
  { name: "Siloé", lat: 3.441, lon: -76.553 },
];
const URGENCY: Record<EmergencyType, number> = { trapped: 1, fire: 1, bleeding: 2, injured: 2, other: 3 };

const SPEECH: Record<number, string> = {
  0: "Presiona el botón grande que dice qué está pasando.",
  1: "Elige quiénes necesitan ayuda y cuántas personas son. Luego presiona continuar.",
  2: "Si quieres, graba un audio corto y di dónde estás. Luego presiona enviar.",
};

type Loc = { lat: number; lon: number; source: "gps" | "mapa" | "lista" };
type Sent = { sosBytes: number; audioBytes: number; audioSeconds: number; status: string };

export default function CitizenApp() {
  const [ready, setReady] = useState<"loading" | "ok" | "error">("loading");
  const [centerKey, setCenterKey] = useState<Uint8Array | null>(null);
  const [step, setStep] = useState(0);
  const [type, setType] = useState<EmergencyType | null>(null);
  const [who, setWho] = useState<WhoKind[]>(["adult"]);
  const [count, setCount] = useState(1);
  const [loc, setLoc] = useState<Loc>({ ...PLACES[0], source: "lista" });
  const [gpsMsg, setGpsMsg] = useState("");
  const [voiceGuide, setVoiceGuide] = useState(false);
  const [recording, setRecording] = useState(false);
  const [remaining, setRemaining] = useState(MAX_AUDIO_S);
  const [audio, setAudio] = useState<{ wav: Uint8Array; seconds: number } | null>(null);
  const [micError, setMicError] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [sent, setSent] = useState<Sent | null>(null);
  const rec = useRef<Recording | null>(null);

  useEffect(() => {
    (async () => {
      try {
        await initCrypto();
        await loadIdentity();
        const r = await fetch("/api/center-key");
        if (!r.ok) throw new Error("center-key");
        setCenterKey(fromBase64((await r.json()).publicKey));
        setReady("ok");
      } catch {
        setReady("error");
      }
    })();
  }, []);

  const speak = useCallback((text: string) => {
    try {
      if (!("speechSynthesis" in window)) return;
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "es-CO";
      window.speechSynthesis.speak(u);
    } catch {
      /* speech is optional */
    }
  }, []);

  useEffect(() => {
    if (voiceGuide && !sent) speak(SPEECH[step]);
  }, [voiceGuide, step, sent, speak]);

  // GPS is attempted when reaching the last screen; the list/map remain as fallbacks.
  useEffect(() => {
    if (step !== 2 || !navigator.geolocation) return;
    setGpsMsg("Buscando tu ubicación…");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLoc({ lat: p.coords.latitude, lon: p.coords.longitude, source: "gps" });
        setGpsMsg("Ubicación por GPS");
      },
      () => setGpsMsg("No se pudo usar el GPS. Elige un lugar o toca el mapa."),
      { timeout: 8000, maximumAge: 60_000 },
    );
  }, [step]);

  const toggleWho = (w: WhoKind) => setWho((cur) => (cur.includes(w) ? (cur.length > 1 ? cur.filter((x) => x !== w) : cur) : [...cur, w]));

  async function toggleRecord() {
    setMicError("");
    if (recording) {
      const r = rec.current;
      if (!r) return;
      setRecording(false);
      const wav = await r.stop();
      setAudio({ wav, seconds: Math.max(1, Math.round((wav.length - 44) / 32000)) });
      return;
    }
    try {
      setAudio(null);
      setRemaining(MAX_AUDIO_S);
      rec.current = await startRecording(MAX_AUDIO_S, setRemaining, () => void toggleRecordStopRef.current());
      setRecording(true);
    } catch {
      setMicError("No pudimos usar el micrófono. Puedes enviar el SOS sin audio.");
    }
  }
  const toggleRecordStopRef = useRef(async () => {});
  toggleRecordStopRef.current = async () => {
    const r = rec.current;
    if (!r) return;
    setRecording(false);
    const wav = await r.stop();
    setAudio({ wav, seconds: Math.max(1, Math.round((wav.length - 44) / 32000)) });
  };

  async function send() {
    if (!type || !centerKey) return;
    setSending(true);
    setSendError("");
    try {
      const identity = await loadIdentity();
      const msgId = randomBytes(16);
      const opts = { identity, centerPublicKey: centerKey };
      const sosPacket = buildSosPacket({ type, who, count, lat: loc.lat, lon: loc.lon }, { ...opts, msgId, urgency: URGENCY[type] });
      const packets = [{ packet: toBase64(sosPacket), path: ["tel-sim", "gw-1"] }];
      if (audio) {
        const chunk = Math.max(AUDIO_CHUNK, Math.ceil(audio.wav.length / 16));
        const total = Math.ceil(audio.wav.length / chunk);
        for (let i = 0; i < total; i++) {
          const part = audio.wav.slice(i * chunk, (i + 1) * chunk);
          packets.push({ packet: toBase64(buildAudioPacket({ parentId: msgId, index: i, total, data: part }, opts)), path: ["tel-sim", "gw-1"] });
        }
      }
      const res = await fetch("/api/ingest", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ packets }) });
      if (!res.ok) throw new Error("ingest");
      const data = (await res.json()) as { results: { status: string; reason?: string }[] };
      const first = data.results[0];
      if (first.status !== "accepted") throw new Error(first.reason ?? first.status);
      setSent({ sosBytes: sosPacket.length, audioBytes: audio?.wav.length ?? 0, audioSeconds: audio?.seconds ?? 0, status: first.status });
      if (voiceGuide) speak("Tu pedido de ayuda fue enviado. Mantén la calma.");
    } catch {
      setSendError("No se pudo enviar. Revisa tu conexión e inténtalo de nuevo.");
    } finally {
      setSending(false);
    }
  }

  function reset() {
    setSent(null);
    setStep(0);
    setType(null);
    setWho(["adult"]);
    setCount(1);
    setAudio(null);
  }

  const markers = useMemo(() => [{ id: "me", lat: loc.lat, lon: loc.lon, color: "#000000", label: "Tu ubicación" }], [loc]);

  if (ready === "loading") return <main className={s.shell}><StateNotice kind="loading">Preparando tu teléfono seguro…</StateNotice></main>;
  if (ready === "error") return <main className={s.shell}><StateNotice kind="error">No pudimos preparar el envío. Recarga la página.</StateNotice></main>;

  return (
    <main className={s.shell}>
      <header className={s.header}>
        <h1 className={s.title}>Pedir ayuda</h1>
        <Button size="sm" selected={voiceGuide} onClick={() => setVoiceGuide((v) => !v)} aria-label="Guía por voz">
          <Icon name="speaker" size={18} /> Voz {voiceGuide ? "sí" : "no"}
        </Button>
      </header>
      <p className={s.meta}>Simulador: este “teléfono” genera paquetes reales firmados y cifrados.</p>

      {sent ? (
        <section aria-labelledby="done" className={s.shell} style={{ padding: 0, minHeight: 0 }}>
          <StateNotice kind="success">
            <strong id="done">Pedido de ayuda enviado.</strong>
            <br />
            Un rescatista lo revisará. Mantente en un lugar seguro y visible si puedes.
          </StateNotice>
          <p className={s.meta}>
            Paquete SOS: {sent.sosBytes} bytes (límite {MAX_SOS_PACKET_BYTES}).
            {sent.audioBytes > 0 && <> Audio: {sent.audioSeconds} s. Con Codec2 (~{CODEC2_BPS} bps) pesaría ~{Math.ceil((sent.audioSeconds * CODEC2_BPS) / 8)} bytes (teórico; en el simulador viaja sin comprimir).</>}
          </p>
          <Button variant="primary" onClick={reset}>Enviar otro pedido</Button>
        </section>
      ) : (
        <>
          <ol className={s.steps} aria-label={`Paso ${step + 1} de 3`}>
            {[0, 1, 2].map((i) => <li key={i} data-done={i <= step} />)}
          </ol>

          {step === 0 && (
            <section aria-labelledby="q1">
              <h2 id="q1" className={s.label}>¿Qué pasa?</h2>
              <div className={s.grid}>
                {TYPES.map((t, i) => (
                  <Button key={t.id} size="xl" variant={t.id === "fire" || t.id === "trapped" ? "default" : "default"} className={i === TYPES.length - 1 ? s.wide : undefined} selected={type === t.id}
                    onClick={() => { setType(t.id); setStep(1); }}>
                    <Icon name={t.id as IconName} /> {t.label}
                  </Button>
                ))}
              </div>
            </section>
          )}

          {step === 1 && (
            <section aria-labelledby="q2">
              <h2 id="q2" className={s.label}>¿Quiénes necesitan ayuda?</h2>
              <div className={s.grid}>
                {WHO.map((w) => (
                  <Button key={w.id} size="xl" selected={who.includes(w.id)} onClick={() => toggleWho(w.id)}>
                    <Icon name={w.id as IconName} /> {w.label}
                  </Button>
                ))}
              </div>
              <h3 className={s.label} style={{ marginTop: "var(--space-4)" }}>¿Cuántas personas?</h3>
              <div className={s.counter} role="group" aria-label="Número de personas">
                <Button className={s.bigRound} aria-label="Menos personas" disabled={count <= 1} onClick={() => setCount((c) => Math.max(1, c - 1))}>−</Button>
                <output className={s.counterValue} aria-live="polite">{count}</output>
                <Button className={s.bigRound} aria-label="Más personas" onClick={() => setCount((c) => Math.min(99, c + 1))}>+</Button>
              </div>
              <div className={s.actions} style={{ marginTop: "var(--space-4)" }}>
                <Button onClick={() => setStep(0)}>Atrás</Button>
                <Button variant="primary" onClick={() => setStep(2)}>Continuar</Button>
              </div>
            </section>
          )}

          {step === 2 && (
            <section aria-labelledby="q3" style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
              <h2 id="q3" className={s.label}>Audio (opcional) y ubicación</h2>
              <Button size="xl" variant={recording ? "critical" : "default"} onClick={toggleRecord} className={recording ? s.recording : undefined}>
                <Icon name="mic" /> {recording ? `Detener (${remaining} s)` : audio ? `Audio de ${audio.seconds} s · grabar de nuevo` : `Grabar audio (máx. ${MAX_AUDIO_S} s)`}
              </Button>
              {micError && <StateNotice kind="error">{micError}</StateNotice>}

              <div className={s.row}>
                <Icon name="pin" size={20} />
                <span>{loc.source === "gps" ? "Ubicación por GPS" : loc.source === "mapa" ? "Punto elegido en el mapa" : "Lugar elegido de la lista"}</span>
                <Badge tone="muted">{loc.lat.toFixed(4)}, {loc.lon.toFixed(4)}</Badge>
              </div>
              {gpsMsg && <p className={s.meta} role="status">{gpsMsg}</p>}
              <label>
                <span className="sr-only">Elegir lugar</span>
                <select className={s.select} value="" onChange={(e) => { const p = PLACES[Number(e.target.value)]; if (p) setLoc({ ...p, source: "lista" }); }}>
                  <option value="" disabled>Elegir un lugar de la lista…</option>
                  {PLACES.map((p, i) => <option key={p.name} value={i}>{p.name}</option>)}
                </select>
              </label>
              <div className={s.mapBox}>
                <DynamicMap center={[loc.lat, loc.lon]} zoom={15} markers={markers} onMapClick={(lat, lon) => setLoc({ lat, lon, source: "mapa" })} ariaLabel="Mapa para elegir tu ubicación; toca para mover el punto" />
              </div>

              {sendError && <StateNotice kind="error">{sendError}</StateNotice>}
              <div className={s.actions}>
                <Button onClick={() => setStep(1)}>Atrás</Button>
                <Button variant="critical" size="sm" disabled={sending || recording} onClick={send} style={{ minHeight: "var(--tap-target-xl)", fontSize: "var(--font-size-lg)" }}>
                  <Icon name="send" size={28} /> {sending ? "Enviando…" : "Enviar"}
                </Button>
              </div>
            </section>
          )}
        </>
      )}

      <p className={s.transparency}>
        <Icon name="lock" size={20} />
        <span>Tu teléfono no puede leer los SOS que retransmite: viajan cifrados.</span>
      </p>
    </main>
  );
}

