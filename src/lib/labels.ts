import type { CaseStatus, Priority } from "./domain/types";
import type { EmergencyType, WhoKind } from "./packet/types";

export const TYPE_LABEL: Record<EmergencyType, string> = {
  trapped: "Trapped",
  injured: "Injured",
  bleeding: "Bleeding",
  fire: "Fire",
  other: "Other",
};
export const WHO_LABEL: Record<WhoKind, string> = { baby: "Baby", child: "Child", adult: "Adult", elder: "Older adult" };
export const STATUS_LABEL: Record<CaseStatus, string> = {
  new: "New",
  validated: "Validated",
  false: "False",
  assigned: "Team assigned",
  dispatched: "Dispatched",
  closed: "Closed",
};
export const PRIORITY_LABEL: Record<Priority, string> = { P1: "P1 · Critical", P2: "P2 · High", P3: "P3 · Medium", P4: "P4 · Low" };
export const SOURCE_LABEL = { meta: "Meta API", mock: "Simulated", rules: "Rules" } as const;

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
