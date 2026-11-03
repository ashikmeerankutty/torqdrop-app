/** Symptoms a driver can tap instead of typing. Keys go to the AI and appear in its evidence refs. */
export const SYMPTOMS = {
  rough_idle: "Rough or shaky idle",
  loss_of_power: "Loss of power",
  hard_start: "Hard to start",
  stalling: "Engine stalls",
  smoke: "Smoke from exhaust",
  overheating: "Running hot",
  noise: "Unusual engine noise",
  burning_smell: "Burning smell",
  poor_mileage: "Poor mileage",
  jerky_shifting: "Jerky gear shifts",
  vibration: "Vibration while driving",
  warning_light: "Warning light on",
} as const;

export type SymptomKey = keyof typeof SYMPTOMS;
export const SYMPTOM_KEYS = Object.keys(SYMPTOMS) as [SymptomKey, ...SymptomKey[]];

/**
 * Strip things a driver might type that the AI doesn't need: email addresses, phone numbers and
 * registration numbers. Free text is otherwise sent as written.
 */
export function redactFreeText(text: string): string {
  return text
    .replace(/[^\s@,;]+@[^\s@,;]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/\+?\d(?:[\s-]?\d){9,}/g, "[number]")
    .replace(/\b[A-Z]{2}[\s-]?\d{1,2}[\s-]?[A-Z]{0,3}[\s-]?\d{4}\b/g, "[registration]")
    .trim();
}
