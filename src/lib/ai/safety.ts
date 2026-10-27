/**
 * Solaris coordinates rescue resources. It must never sound like medical advice or diagnosis.
 * Any AI-produced text is checked against this list; offending text is replaced by a safe template.
 */
export const FORBIDDEN_MEDICAL_TERMS = [
  "diagnos",
  "tratamiento",
  "medicamento",
  "medicina",
  "pastilla",
  "torniquete",
  "vendaje",
  "vende ",
  "aplique",
  "aplica ",
  "presione la herida",
  "presiona la herida",
  "no mueva",
  "no muevas",
  "reanim",
  "rcp",
  "inyecc",
  "dosis",
  "fractura",
  "hemorragia",
  "primeros auxilios",
  "usted debe",
  "debes ",
  // English
  "treatment",
  "medication",
  "tourniquet",
  "bandage",
  "apply pressure",
  "do not move",
  "cpr",
  "resuscitat",
  "dosage",
  "fracture",
  "hemorrhage",
  "first aid",
  "you must",
];

export function containsMedicalAdvice(text: string): boolean {
  const t = text.toLowerCase();
  return FORBIDDEN_MEDICAL_TERMS.some((w) => t.includes(w));
}

export const SAFE_FALLBACK_JUSTIFICATION =
  "Priority computed from the vulnerability of the people reported and site conditions. Requires rescuer validation.";
