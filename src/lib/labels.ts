import type { CaseStatus, Priority } from "./domain/types";
import type { EmergencyType, WhoKind } from "./packet/types";

export const TYPE_LABEL: Record<EmergencyType, string> = {
  trapped: "Atrapado",
  injured: "Herido",
  bleeding: "Sangrado",
  fire: "Incendio",
  other: "Otro",
};
export const WHO_LABEL: Record<WhoKind, string> = { baby: "Bebé", child: "Niño", adult: "Adulto", elder: "Adulto mayor" };
export const STATUS_LABEL: Record<CaseStatus, string> = {
  new: "Nuevo",
  validated: "Validado",
  false: "Falso",
  assigned: "Equipo asignado",
  dispatched: "Despachado",
  closed: "Cerrado",
};
export const PRIORITY_LABEL: Record<Priority, string> = { P1: "P1 · Crítica", P2: "P2 · Alta", P3: "P3 · Media", P4: "P4 · Baja" };
export const SOURCE_LABEL = { meta: "Meta API", mock: "Simulado", rules: "Reglas" } as const;

export function fmtWait(ms: number): string {
  const m = Math.max(0, Math.floor(ms / 60000));
  if (m < 1) return "<1 min";
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

/** Read a design token at runtime (needed where a real color value is required, e.g. map markers). */
export function cssVar(name: string, fallback = "#000000"): string {
  if (typeof window === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}
