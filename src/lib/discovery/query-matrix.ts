import { categoryCodes, type CategoryCode } from "../taxonomy/categories.ts";

export const DISCOVERY_POLICY_VERSION = "discovery-v1";
export const DISCOVERY_COUNTIES = ["Cook", "DuPage", "Kane", "Lake", "McHenry", "Will", "Kendall"] as const;
export const DISCOVERY_MAX_QUERY_CELLS = 5;
export const DISCOVERY_MAX_UNIQUE_LEADS = 50;
export const DISCOVERY_MAX_PROVIDER_CALLS = 100;

export type DiscoveryQueryCell = { category: CategoryCode; county: typeof DISCOVERY_COUNTIES[number]; query: string };

export function discoveryQueryCells(categories: readonly CategoryCode[] = categoryCodes, counties = DISCOVERY_COUNTIES): DiscoveryQueryCell[] {
  return categories.flatMap((category) => counties.map((county) => ({ category, county, query: `${category.replace(/_/g, " ")} services ${county} County Illinois` })));
}
