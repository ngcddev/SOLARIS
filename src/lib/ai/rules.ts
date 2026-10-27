import type { Priority } from "../domain/types";
import type { TriageInput, TriageOutput } from "./types";
import { containsMedicalAdvice, SAFE_FALLBACK_JUSTIFICATION } from "./safety";

/** Level 3: keyword + button rules. No internet, no AI. Same output shape as the Spark provider. */

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

const KEYWORDS: { re: RegExp; score: number; tag: "trapped" | "baby" | "child" | "elder" | "fire" | "blood" | "collapse" }[] = [
  { re: /atrapad|escombro|aplastad|derrumb|no puede salir|no podemos salir|bajo (la|el)|trapped|rubble|crushed|cannot get out|can't get out|stuck/, score: 3, tag: "trapped" },
  { re: /sangr|herid|mucha sangre|bleeding|blood|wounded|injur/, score: 2, tag: "blood" },
  { re: /incendi|fuego|humo|quem|\bfire\b|smoke|burning/, score: 3, tag: "fire" },
  { re: /bebe|recien nacid|\bbaby|\bbabies|newborn|infant/, score: 2, tag: "baby" },
  { re: /\bnino|\bnina|menor|hijo|hija|\bchild|\bkid|daughter/, score: 1, tag: "child" },
  { re: /abuel|anciano|adulto mayor|tercera edad|elderly|grandmother|grandfather|older adult/, score: 1, tag: "elder" },
  { re: /colaps|se cayo|casa caida|edificio caido|collapse|fell down/, score: 1, tag: "collapse" },
];
const JOKE = /jaja|jeje|broma|es mentira|probando|test\b|hola hola|pizza|futbol|haha|joke|just kidding|testing/;
const CALM = /sin novedad|no pasa nada|todo bien|estoy bien|all good|nothing happened|i am fine|i'm fine/;

export function triageByRules(input: TriageInput): TriageOutput {
  const text = norm(input.transcript ?? "");
  const tags = new Set(KEYWORDS.filter((k) => k.re.test(text)).map((k) => k.tag));

  const typeBase = { trapped: 4, bleeding: 3, fire: 4, injured: 2, other: 0 }[input.type];
  const trapped = input.type === "trapped" || tags.has("trapped");
  const hasBabies = input.who.includes("baby") || tags.has("baby");
  const hasChildren = input.who.includes("child") || tags.has("child");
  const hasElderly = input.who.includes("elder") || tags.has("elder");

  let score = typeBase;
  if (trapped && input.type !== "trapped") score += 3;
  if (tags.has("fire") && input.type !== "fire") score += 2;
  if (tags.has("blood") && input.type !== "bleeding") score += 1;
  if (hasBabies) score += 2;
  if (hasChildren) score += 1;
  if (hasElderly) score += 1;
  if (input.count >= 4) score += 1;
  if (input.count >= 8) score += 1;
  if (input.waitMinutes >= 30) score += 1;
  if (input.waitMinutes >= 120) score += 1;

  let coherence = 0.85;
  if (JOKE.test(text)) coherence = 0.1;
  else if (CALM.test(text) && input.type !== "other") coherence = 0.25;
  else if (!text) coherence = 0.8;

  const priority: Priority = score >= 6 ? "P1" : score >= 4 ? "P2" : score >= 2 ? "P3" : "P4";
  return {
    emergencyType: input.type,
    people: Math.max(1, input.count),
    hasBabies,
    hasChildren,
    hasElderly,
    trapped,
    priority,
    justification: rescuerJustification({ ...input, trapped, hasBabies, hasChildren, hasElderly }, priority, "Rules"),
    coherence,
  };
}

const TYPE_LABEL = { trapped: "people trapped", injured: "injured people reported", bleeding: "bleeding reported", fire: "fire reported", other: "unclassified emergency" } as const;

/** Logistics-oriented explanation for the rescuer. Never advice for the victim. */
export function rescuerJustification(
  i: Pick<TriageInput, "type" | "count" | "waitMinutes"> & { trapped: boolean; hasBabies: boolean; hasChildren: boolean; hasElderly: boolean },
  priority: Priority,
  origin: string,
): string {
  const parts = [`${origin}: ${TYPE_LABEL[i.type]}, ${i.count} ${i.count === 1 ? "person" : "people"}`];
  const vulnerable = [i.hasBabies && "babies", i.hasChildren && "children", i.hasElderly && "older adults"].filter(Boolean);
  if (vulnerable.length) parts.push(`includes ${vulnerable.join(", ")}`);
  if (i.trapped && i.type !== "trapped") parts.push("possible entrapment");
  if (i.waitMinutes >= 30) parts.push(`${Math.round(i.waitMinutes)} min waiting`);
  parts.push(`suggested priority ${priority}; requires rescuer validation`);
  const text = parts.join("; ") + ".";
  return containsMedicalAdvice(text) ? SAFE_FALLBACK_JUSTIFICATION : text;
}
