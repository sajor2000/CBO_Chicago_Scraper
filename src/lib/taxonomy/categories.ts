export const categoryCodes = [
  "food_access",
  "clinic_fqhc",
  "shelter_housing",
  "mental_health",
  "substance_use",
  "benefits",
  "transportation",
  "domestic_violence_crisis",
  "immigrant_refugee_support",
  "wic"
] as const;

export type CategoryCode = typeof categoryCodes[number];
const approved = new Set<string>(categoryCodes);
export const approvedCategory = (value: string | undefined): CategoryCode | undefined => value && approved.has(value) ? value as CategoryCode : undefined;
