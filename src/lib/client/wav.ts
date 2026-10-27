/** Browser-side audio capture: records up to `maxSeconds` and returns WAV mono PCM16 @ 16 kHz (the Voice Transcribe input format). */

const TARGET_RATE = 16000;

export interface Recording {
  stop(): Promise<Uint8Array>;
  cancel(): void;
}

export async function startRecording(maxSeconds: number, onTick: (remaining: number) => void, onAutoStop: () => void): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const rec = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise<void>((res) => (rec.onstop = () => res()));
  rec.start();
  const started = Date.now();
  const timer = setInterval(() => {
    const left = Math.max(0, maxSeconds - Math.floor((Date.now() - started) / 1000));
    onTick(left);
    if (left === 0) {
      clearInterval(timer);
      onAutoStop();
    }
  }, 250);
  const release = () => {
    clearInterval(timer);
    stream.getTracks().forEach((t) => t.stop());
  };
  return {
    async stop() {
      clearInterval(timer);
      if (rec.state !== "inactive") rec.stop();
      await stopped;
      release();
      return toWav(new Blob(chunks, { type: rec.mimeType }), maxSeconds);
    },
    cancel() {
      if (rec.state !== "inactive") rec.stop();
      release();
    },
  };
}

async function toWav(blob: Blob, maxSeconds: number): Promise<Uint8Array> {
  const ctx = new AudioContext();
  const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
  await ctx.close();
  const frames = Math.min(Math.ceil(decoded.duration * TARGET_RATE), maxSeconds * TARGET_RATE);
  const off = new OfflineAudioContext(1, Math.max(1, frames), TARGET_RATE);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start();
  const mono = (await off.startRendering()).getChannelData(0);
  return encodeWav(mono, TARGET_RATE);
}

export function encodeWav(samples: Float32Array, rate: number): Uint8Array {
  const out = new Uint8Array(44 + samples.length * 2);
  const dv = new DataView(out.buffer);
  const str = (o: number, s: string) => [...s].forEach((c, i) => dv.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  dv.setUint32(4, 36 + samples.length * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true); // PCM
  dv.setUint16(22, 1, true); // mono
  dv.setUint32(24, rate, true);
  dv.setUint32(28, rate * 2, true);
  dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true);
  str(36, "data");
  dv.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    dv.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
  }
  return out;
}
