"use client";

import { useEffect, useRef, useState } from "react";
import type { Case, FieldPhoto } from "@/lib/domain/types";
import { SOURCE_LABEL } from "@/lib/labels";
import { postJson } from "@/lib/client/useCommandState";
import { Button, StateNotice } from "../ui";
import s from "./command-center.module.css";

const MAX_SIDE = 1024;

/** Dash styles instead of colors: the palette stays black & white. */
const STYLE: Record<string, { dash: number[]; width: number }> = {
  person: { dash: [], width: 4 },
  "collapsed structure": { dash: [14, 8], width: 3 },
  "blocked road": { dash: [3, 6], width: 3 },
};

function MaskedImage({ photo }: { photo: FieldPhoto }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !photo.dataUrl) return;
    const img = new Image();
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      for (const f of photo.findings) {
        const st = STYLE[f.phrase] ?? { dash: [], width: 3 };
        for (const m of f.masks) {
          ctx.beginPath();
          m.points.forEach(([x, y], i) => (i ? ctx.lineTo(x * img.width, y * img.height) : ctx.moveTo(x * img.width, y * img.height)));
          ctx.closePath();
          ctx.fillStyle = "rgba(255,255,255,0.25)";
          ctx.fill();
          ctx.lineWidth = st.width + 3;
          ctx.setLineDash([]);
          ctx.strokeStyle = "#fff";
          ctx.stroke();
          ctx.lineWidth = st.width;
          ctx.setLineDash(st.dash);
          ctx.strokeStyle = "#000";
          ctx.stroke();
        }
      }
    };
    img.src = photo.dataUrl;
  }, [photo]);
  const summary = photo.findings.map((f) => `${f.phrase}: ${f.count}`).join(", ") || "no findings";
  return <canvas ref={ref} role="img" aria-label={`Field photo with segmentation masks. Findings: ${summary}`} style={{ width: "100%", height: "auto", border: "var(--border-width) solid var(--color-border)", borderRadius: "var(--radius-md)" }} />;
}

async function fileToDataUrl(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.8);
}

/** Placeholder picture so the flow can be demoed without a real photo. Clearly labelled as an example. */
function sampleImage(seed: string): string {
  const c = document.createElement("canvas");
  c.width = 800;
  c.height = 560;
  const ctx = c.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, 0, 560);
  g.addColorStop(0, "#d9d9d9");
  g.addColorStop(1, "#6b6b6b");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 800, 560);
  ctx.fillStyle = "#3c3c3c";
  for (let i = 0; i < 9; i++) ctx.fillRect(40 + i * 82, 300 - ((i * 37 + seed.length * 13) % 120), 60, 260);
  ctx.fillStyle = "#fff";
  ctx.font = "bold 22px sans-serif";
  ctx.fillText("SAMPLE IMAGE (not a real photo)", 150, 40);
  return c.toDataURL("image/jpeg", 0.8);
}

export default function FieldPhotos({ c, onChanged }: { c: Case; onChanged: () => void }) {
  const [full, setFull] = useState<FieldPhoto[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string }>();
  const count = c.photos.length;

  useEffect(() => {
    let alive = true;
    if (count === 0) {
      setFull([]);
      return;
    }
    fetch(`/api/cases/${c.id}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: Case) => alive && setFull(d.photos))
      .catch(() => alive && setMsg({ kind: "error", text: "The photos could not be loaded." }));
    return () => {
      alive = false;
    };
  }, [c.id, count]);

  async function upload(dataUrl: string) {
    setBusy(true);
    setMsg(undefined);
    const res = await postJson<{ error?: string }>(`/api/cases/${c.id}/photo`, { dataUrl });
    setMsg(res.ok ? { kind: "success", text: "Photo analyzed and attached to the case." } : { kind: "error", text: res.data.error ?? "The photo could not be uploaded." });
    onChanged();
    setBusy(false);
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    try {
      await upload(await fileToDataUrl(f));
    } catch {
      setMsg({ kind: "error", text: "The image could not be read." });
    }
  }

  return (
    <div>
      <h3 className={s.h3}>Field photos ({count})</h3>
      <p className={s.rowMeta}>Photos are uploaded by rescuers or drones with connectivity. They do not come from the citizen SOS: a photo does not fit on the mesh.</p>
      <div className={s.actions} style={{ margin: "var(--space-2) 0" }}>
        <label>
          <span className="sr-only">Upload field photo</span>
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={onFile} disabled={busy} />
        </label>
        <Button size="sm" disabled={busy} onClick={() => upload(sampleImage(c.id))}>Use sample image</Button>
      </div>
      {busy && <StateNotice kind="loading">Analyzing image…</StateNotice>}
      {msg && <StateNotice kind={msg.kind}>{msg.text}</StateNotice>}
      {full.map((p) => (
        <figure key={p.id} style={{ margin: "var(--space-2) 0" }}>
          <MaskedImage photo={p} />
          <figcaption className={s.rowMeta}>
            Segmentation ({SOURCE_LABEL[p.source]}): {p.findings.length ? p.findings.map((f) => `${f.phrase} ×${f.count}`).join(" · ") : "no analysis (offline mode)"}.
            {" "}Thick solid outline = person; dashed = collapsed structure; dotted = blocked road.
          </figcaption>
        </figure>
      ))}
    </div>
  );
}
