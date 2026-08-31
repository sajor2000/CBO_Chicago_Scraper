import { approvedCategory, type CategoryCode } from "../taxonomy/categories.ts";

export const DISCOVERY_QUERY_POLICY_VERSION = "chicago-seven-county-v1";
export const discoveryCounties = ["Cook", "DuPage", "Kane", "Kendall", "Lake", "McHenry", "Will"] as const;
export type DiscoveryCounty = typeof discoveryCounties[number];

const terms: Record<CategoryCode, readonly string[]> = {
  food_access: ["food pantry", "community food assistance"],
  clinic_fqhc: ["community health center", "federally qualified health center"],
  shelter_housing: ["homeless shelter", "housing assistance nonprofit"],
  mental_health: ["community mental health nonprofit"],
  substance_use: ["community substance use treatment nonprofit"],
  benefits: ["public benefits assistance nonprofit"],
  transportation: ["nonprofit medical transportation"],
  domestic_violence_crisis: ["domestic violence crisis center"],
  immigrant_refugee_support: ["immigrant refugee support nonprofit"],
  wic: ["WIC clinic"]
};

export interface DiscoveryQueryCell { id: string; category: CategoryCode; county: DiscoveryCounty; query: string; provider: "google_places" | "search_fallback"; resultCap: number; policyVersion: string }

export function resolveDiscoveryQueryCells(input: { categories: readonly string[]; counties: readonly string[]; maxCells?: number }): DiscoveryQueryCell[] {
  const categories = [...new Set(input.categories)].map((value) => approvedCategory(value)).filter((value): value is CategoryCode => Boolean(value));
  const counties = [...new Set(input.counties)].filter((value): value is DiscoveryCounty => discoveryCounties.includes(value as DiscoveryCounty));
  if (!categories.length || !counties.length || categories.length !== new Set(input.categories).size || counties.length !== new Set(input.counties).size) throw new Error("Only approved discovery categories and counties may be selected.");
  const cells = categories.flatMap((category) => counties.flatMap((county) =>
    terms[category].flatMap((term, termIndex) =>
      (["google_places", "search_fallback"] as const).map((provider) => ({
        id: `${DISCOVERY_QUERY_POLICY_VERSION}:${category}:${county}:${termIndex}:${provider}`,
        category, county, query: `${term} in ${county} County Illinois`, provider,
        resultCap: 5, policyVersion: DISCOVERY_QUERY_POLICY_VERSION
      }))
    )
  ));
  const cap = Math.max(1, Math.min(input.maxCells ?? 10, 10));
  if (cells.length > cap) throw new Error(`Resolved discovery query cells exceed the ${cap}-cell launch cap.`);
  return cells;
}
