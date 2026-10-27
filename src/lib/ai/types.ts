import type { EmergencyType, WhoKind } from "../packet/types";
import type { AiSource, PhotoFinding, Priority, Team } from "../domain/types";

export type AiMode = "meta" | "mock" | "rules";

export interface TranscriptionInput {
  /** WAV mono PCM16 16 kHz (or the simulated fixture, see mock). */
  audio: Uint8Array;
  /** Emergency vocabulary for keyword biasing. */
  keywords: string[];
  language: "es";
}
export interface TranscriptionProvider {
  transcribe(input: TranscriptionInput): Promise<{ text: string }>;
}

export interface TriageInput {
  type: EmergencyType;
  who: WhoKind[];
  count: number;
  lat: number;
  lon: number;
  waitMinutes: number;
  transcript?: string;
}
/** Raw triage result before source/latency are attached (validated with Zod). */
export interface TriageOutput {
  emergencyType: EmergencyType;
  people: number;
  hasBabies: boolean;
  hasChildren: boolean;
  hasElderly: boolean;
  trapped: boolean;
  priority: Priority;
  justification: string;
  coherence: number;
}
export interface TriageProvider {
  triage(input: TriageInput): Promise<TriageOutput>;
}

export interface AnalystCase {
  id: string;
  priority: Priority;
  trust: number;
  people: number;
  type: EmergencyType;
  trapped: boolean;
  lat: number;
  lon: number;
  waitMinutes: number;
  justification: string;
}
export interface AnalystInput {
  cases: AnalystCase[];
  teams: Team[];
}
export interface AssignmentSuggestion {
  caseId: string;
  teamId: string;
  rationale: string;
}
export interface AnalystOutput {
  assignments: AssignmentSuggestion[];
  notes: string;
}
export interface AnalystProvider {
  recommend(input: AnalystInput): Promise<AnalystOutput>;
}

export interface VisionInput {
  imageDataUrl: string;
  phrases: string[];
}
export interface VisionProvider {
  segment(input: VisionInput): Promise<PhotoFinding[]>;
}

export interface ProviderSet {
  source: AiSource;
  transcription: TranscriptionProvider;
  triage: TriageProvider;
  analyst: AnalystProvider;
  vision: VisionProvider;
}
