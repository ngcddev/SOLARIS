import type { PhotoFinding } from "../domain/types";
import { greedyAssignment } from "../priority/queue";
import { crossCheckByRules, handoverByRules } from "./reports";
import { rescuerJustification, triageByRules } from "./rules";
import type { AnalystProvider, ProviderSet, TranscriptionProvider, TriageProvider, VisionProvider } from "./types";

/** Deterministic mocks: results derive from the content, never from randomness, so demos are reproducible. */

export const SIMULATED_AUDIO_PREFIX = "SIMULATED_AUDIO:";

export function hash32(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const NUMBER_WORDS: Record<string, number> = { dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10 };

export const mockTranscription: TranscriptionProvider = {
  async transcribe({ audio }) {
    const head = new TextDecoder().decode(audio.slice(0, SIMULATED_AUDIO_PREFIX.length));
    if (head === SIMULATED_AUDIO_PREFIX) {
      return { text: new TextDecoder().decode(audio.slice(SIMULATED_AUDIO_PREFIX.length)) };
    }
    return { text: "" }; // real recorded audio cannot be transcribed in simulated mode
  },
};

export const mockTriage: TriageProvider = {
  async triage(input) {
    const text = (input.transcript ?? "").toLowerCase();
    // Spark-like extraction: people count mentioned in speech overrides a default of 1.
    const digit = text.match(/\b(\d{1,2})\s*(personas|ni[ñn]os|adultos|heridos)/)?.[1];
    const word = Object.keys(NUMBER_WORDS).find((w) => new RegExp(`\\b(somos|son|hay)\\s+${w}\\b`).test(text));
    const spoken = digit ? Number(digit) : word ? NUMBER_WORDS[word] : 0;
    const base = triageByRules({ ...input, count: Math.max(input.count, spoken) });
    return { ...base, justification: rescuerJustification({ ...input, count: base.people, trapped: base.trapped, hasBabies: base.hasBabies, hasChildren: base.hasChildren, hasElderly: base.hasElderly }, base.priority, "Simulated analysis") };
  },
};

export const mockAnalyst: AnalystProvider = {
  async recommend(input) {
    const out = greedyAssignment(input);
    return { ...out, notes: `[Simulated] ${out.notes}` };
  },
  // The mock analyst reuses the deterministic rules so demos are reproducible.
  async crossCheck(input) {
    return crossCheckByRules(input);
  },
  async handover(input) {
    return handoverByRules(input);
  },
};

const PHRASE_COUNTS: Record<string, [number, number]> = {
  person: [1, 4],
  "collapsed structure": [0, 2],
  "blocked road": [0, 2],
};

export const mockVision: VisionProvider = {
  async segment({ imageDataUrl, phrases }) {
    const seed = hash32(imageDataUrl.slice(-2048) + imageDataUrl.length);
    return phrases.map((phrase, pi): PhotoFinding => {
      const [lo, hi] = PHRASE_COUNTS[phrase] ?? [0, 2];
      const count = lo + ((seed >>> (pi * 3)) % (hi - lo + 1));
      const masks = Array.from({ length: count }, (_, i) => {
        const s = hash32(`${seed}-${pi}-${i}`);
        const cx = 0.15 + ((s % 700) / 1000);
        const cy = 0.15 + (((s >>> 8) % 700) / 1000);
        const w = 0.08 + ((s >>> 16) % 12) / 100;
        const h = 0.1 + ((s >>> 20) % 15) / 100;
        return {
          score: 0.7 + ((s >>> 4) % 25) / 100,
          points: [
            [cx - w, cy - h * 0.6],
            [cx, cy - h],
            [cx + w, cy - h * 0.6],
            [cx + w * 0.8, cy + h],
            [cx - w * 0.8, cy + h],
          ].map(([x, y]) => [Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y))] as [number, number]),
        };
      });
      return { phrase, count, masks };
    });
  },
};

export const mockProviders: ProviderSet = {
  source: "mock",
  transcription: mockTranscription,
  triage: mockTriage,
  analyst: mockAnalyst,
  vision: mockVision,
};
