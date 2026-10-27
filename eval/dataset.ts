import type { Priority } from "../src/lib/domain/types";
import type { TriageInput } from "../src/lib/ai/types";
import type { EmergencyType, WhoKind } from "../src/lib/packet/types";

/**
 * Human-labeled triage dataset. Labels follow the written rubric in docs/EVALUATION.md
 * (class -> base priority -> escalations/de-escalations). They are NOT derived from any engine output.
 * Transcripts are mostly Spanish on purpose (they model SOS from Cali, Colombia); some are English.
 */
export interface EvalCase {
  id: string;
  input: TriageInput;
  expectedPriority: Priority;
  /** True when the report is a joke / contradictory (credibility is judged by the trust layer, not by priority). */
  expectedLowCoherence?: boolean;
  tags: string[];
}

const LAT = 3.4516;
const LON = -76.532;

function c(
  id: string,
  type: EmergencyType,
  who: WhoKind[],
  count: number,
  waitMinutes: number,
  transcript: string | undefined,
  expectedPriority: Priority,
  tags: string[],
  lowCoherence = false,
): EvalCase {
  return {
    id,
    input: { type, who, count, waitMinutes, transcript, lat: LAT, lon: LON },
    expectedPriority,
    expectedLowCoherence: lowCoherence || undefined,
    tags,
  };
}

export const DATASET: EvalCase[] = [
  // ---- A. Entrapment (base P2) ----
  c("A01", "trapped", ["adult"], 1, 5, undefined, "P2", ["trapped", "buttons-only"]),
  c("A02", "trapped", ["adult"], 2, 10, "Estamos atrapados bajo los escombros, somos dos", "P2", ["trapped", "es"]),
  c("A03", "trapped", ["adult"], 3, 20, "Se derrumbó la pared de la cocina y no podemos salir", "P2", ["trapped", "es"]),
  c("A04", "trapped", ["adult", "baby"], 3, 5, undefined, "P1", ["trapped", "vulnerable", "buttons-only"]),
  c("A05", "trapped", ["adult", "child"], 3, 8, "Mi hija de cinco años está atrapada conmigo", "P1", ["trapped", "vulnerable", "es"]),
  c("A06", "trapped", ["adult", "elder"], 2, 12, "Mi abuela y yo estamos atrapadas bajo el techo", "P1", ["trapped", "vulnerable", "es"]),
  c("A07", "trapped", ["adult"], 5, 15, undefined, "P1", ["trapped", "group", "buttons-only"]),
  c("A08", "trapped", ["adult"], 9, 30, "Somos nueve, quedamos bajo los escombros del edificio", "P1", ["trapped", "group", "es"]),
  c("A09", "trapped", ["adult"], 1, 150, "Llevo mucho tiempo atrapado, nadie ha llegado", "P1", ["trapped", "long-wait", "es"]),
  c("A10", "trapped", ["adult"], 2, 5, "We are trapped under rubble, two of us", "P2", ["trapped", "en"]),
  c("A11", "trapped", ["adult", "baby"], 4, 5, "A baby is trapped with us under the rubble", "P1", ["trapped", "vulnerable", "en"]),
  c("A12", "trapped", ["adult", "child"], 2, 3, "My daughter and I are stuck, the ceiling fell on us", "P1", ["trapped", "vulnerable", "en"]),
  c("A13", "other", ["adult"], 1, 10, "Se cayó el techo y estoy atrapado, no puedo salir", "P2", ["trapped", "button-text-mismatch", "es"]),
  c("A14", "injured", ["adult"], 2, 10, "Estamos bajo los escombros, uno de nosotros está herido", "P2", ["trapped", "mixed", "es"]),
  c("A15", "bleeding", ["adult"], 2, 10, "Está sangrando mucho y estamos atrapados bajo la pared", "P1", ["trapped", "bleeding", "combo", "es"]),
  c("A16", "fire", ["adult"], 3, 5, "Incendio y estamos atrapados en el segundo piso, mucho humo", "P1", ["trapped", "fire", "combo", "es"]),
  c("A17", "trapped", ["child"], 1, 5, "Un niño solo, atrapado en la casa que se cayó", "P1", ["trapped", "vulnerable", "es"]),
  c("A18", "trapped", ["adult"], 2, 35, "Atrapados bajo una viga, estamos conscientes", "P2", ["trapped", "es"]),
  c("A19", "trapped", ["adult"], 1, 60, "Atrapado en el garaje", "P2", ["trapped", "es"]),
  c("A20", "trapped", ["adult", "baby", "child", "elder"], 6, 45, "Cuatro adultos, una niña y un bebé atrapados en la casa", "P1", ["trapped", "vulnerable", "group", "es"]),

  // ---- B. Fire (base P2) ----
  c("B01", "fire", ["adult"], 1, 5, undefined, "P2", ["fire", "buttons-only"]),
  c("B02", "fire", ["adult"], 2, 10, "Se está quemando la casa del lado, hay humo", "P2", ["fire", "es"]),
  c("B03", "fire", ["adult", "baby"], 3, 5, undefined, "P1", ["fire", "vulnerable", "buttons-only"]),
  c("B04", "fire", ["adult", "elder"], 2, 5, "Incendio en la cocina por el gas, mi abuelo no puede caminar", "P1", ["fire", "vulnerable", "es"]),
  c("B05", "fire", ["adult"], 5, 10, undefined, "P1", ["fire", "group", "buttons-only"]),
  c("B06", "fire", ["adult"], 2, 5, "There is a fire in the building, smoke everywhere", "P2", ["fire", "en"]),
  c("B07", "fire", ["adult"], 1, 3, "Conato de incendio ya controlado, solo queda un poco de humo", "P3", ["fire", "de-escalation", "es"]),
  c("B08", "fire", ["adult", "child"], 4, 10, "Fire in the apartment, two kids inside", "P1", ["fire", "vulnerable", "en"]),

  // ---- C. Bleeding (base P3) ----
  c("C01", "bleeding", ["adult"], 1, 5, undefined, "P3", ["bleeding", "buttons-only"]),
  c("C02", "bleeding", ["adult"], 1, 10, "Se cortó con los vidrios, sangra bastante", "P3", ["bleeding", "es"]),
  c("C03", "bleeding", ["adult", "baby"], 2, 5, undefined, "P2", ["bleeding", "vulnerable", "buttons-only"]),
  c("C04", "bleeding", ["adult", "child"], 2, 5, "Mi hijo está sangrando, nos cayó la lámpara", "P2", ["bleeding", "vulnerable", "es"]),
  c("C05", "bleeding", ["adult"], 4, 10, undefined, "P2", ["bleeding", "group", "buttons-only"]),
  c("C06", "bleeding", ["adult", "elder"], 2, 8, "Mi mamá de 80 años se cortó, sangra", "P2", ["bleeding", "vulnerable", "es"]),
  c("C07", "bleeding", ["adult"], 1, 5, "He is bleeding from his arm", "P3", ["bleeding", "en"]),
  c("C08", "bleeding", ["adult"], 1, 5, "Es un rasguño pequeño en la mano, nada grave", "P4", ["bleeding", "de-escalation", "es"]),
  c("C09", "bleeding", ["adult"], 1, 130, "Sigue sangrando y nadie ha venido", "P2", ["bleeding", "long-wait", "es"]),
  c("C10", "bleeding", ["baby"], 1, 5, undefined, "P2", ["bleeding", "vulnerable", "buttons-only"]),

  // ---- D. Injury / stranded (base P3) ----
  c("D01", "injured", ["adult"], 1, 5, undefined, "P3", ["injured", "buttons-only"]),
  c("D02", "injured", ["adult"], 2, 10, "Hay dos heridos en la casa, el vidrio se rompió", "P3", ["injured", "es"]),
  c("D03", "injured", ["adult", "elder"], 1, 10, "Mi papá se cayó con el temblor y tiene mucho dolor, es adulto mayor", "P2", ["injured", "vulnerable", "es"]),
  c("D04", "injured", ["adult", "child"], 3, 5, "Mi niño se golpeó la cabeza con la pared", "P2", ["injured", "vulnerable", "es"]),
  c("D05", "injured", ["adult"], 6, 20, undefined, "P2", ["injured", "group", "buttons-only"]),
  c("D06", "injured", ["adult"], 2, 5, "Two people hurt, we are outside the house", "P3", ["injured", "en"]),
  c("D07", "injured", ["adult"], 1, 5, "Solo tiene raspones, ya está estable", "P4", ["injured", "de-escalation", "es"]),
  c("D08", "injured", ["adult", "baby"], 2, 5, undefined, "P2", ["injured", "vulnerable", "buttons-only"]),
  c("D09", "injured", ["adult"], 1, 200, "Estamos esperando hace horas, sigue herido", "P2", ["injured", "long-wait", "es"]),
  c("D10", "injured", ["adult", "child"], 2, 100, "Está herido y necesitamos ayuda", "P2", ["injured", "vulnerable", "es"]),
  c("D11", "injured", ["adult"], 1, 5, "Se cayó de la escalera, está consciente y hablando", "P3", ["injured", "es"]),
  c("D12", "other", ["elder"], 1, 10, "Mi mamá de 80 años está sola y no puede salir de la casa", "P2", ["stranded", "vulnerable", "es"]),
  c("D13", "other", ["adult", "elder"], 1, 10, "Hay un anciano solo en el tercer piso y no puede bajar", "P2", ["stranded", "vulnerable", "es"]),

  // ---- E. Damage only / people safe (base P4) ----
  c("E01", "other", ["adult"], 2, 10, "Se agrietó el edificio, estamos todos afuera y bien", "P4", ["damage", "es"]),
  c("E02", "other", ["adult"], 3, 15, "La casa quedó muy dañada, estamos en la calle", "P4", ["damage", "es"]),
  c("E03", "other", ["adult", "baby"], 2, 10, "Edificio agrietado, estamos afuera con un bebé", "P3", ["damage", "vulnerable", "es"]),
  c("E04", "other", ["adult"], 1, 5, undefined, "P4", ["damage", "buttons-only"]),
  c("E05", "other", ["adult"], 1, 5, "Building has cracks, we are all outside", "P4", ["damage", "en"]),
  c("E06", "other", ["adult", "child", "baby"], 3, 20, "Grietas en la casa, estamos afuera con los niños", "P3", ["damage", "vulnerable", "es"]),
  c("E07", "other", ["adult"], 2, 150, "Sin agua ni comida desde hace horas, estamos afuera", "P3", ["damage", "long-wait", "es"]),

  // ---- F. Jokes / incoherent reports (priority labeled by the situation AS REPORTED; credibility is the trust layer's job) ----
  c("F01", "trapped", ["adult", "baby", "child"], 12, 5, "jajaja es una broma, estoy probando esto, mándenme una pizza", "P1", ["joke", "es"], true),
  c("F02", "fire", ["adult"], 1, 5, "hahaha just kidding, testing the app", "P2", ["joke", "en"], true),
  c("F03", "other", ["adult"], 1, 5, "hola hola probando, quiero una pizza", "P4", ["joke", "es"], true),
  c("F04", "injured", ["adult"], 1, 5, "todo bien, no pasa nada, sin novedad", "P4", ["contradiction", "es"], true),
  c("F05", "other", ["adult"], 1, 5, "all good, nothing happened", "P4", ["contradiction", "en"], true),
];
