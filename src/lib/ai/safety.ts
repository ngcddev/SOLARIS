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
];

export function containsMedicalAdvice(text: string): boolean {
  const t = text.toLowerCase();
  return FORBIDDEN_MEDICAL_TERMS.some((w) => t.includes(w));
}

export const SAFE_FALLBACK_JUSTIFICATION =
  "Prioridad calculada por vulnerabilidad de las personas reportadas y condiciones del lugar. Requiere validación del rescatista.";
