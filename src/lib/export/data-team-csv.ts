import { directSourceColumns, sourceRelations, type SourceRelation } from "../imports/cbo-baseline.ts";

export const dataTeamRelations = sourceRelations;
export type DataTeamRelation = SourceRelation;

const aliases: Record<DataTeamRelation, Record<string, string>> = {
  community_resource_locations: { address: "full_address", website: "hyperlink", name: "organization_name" },
  wic_locations: { address: "full_address", name: "location_name" }
};

export type DataTeamHandoffRow = { sourceRecord: Record<string, unknown>; approvedValues: Record<string, string> };

export const isDataTeamRelation = (value: string | null): value is DataTeamRelation => dataTeamRelations.includes(value as DataTeamRelation);
const text = (value: unknown) => value === null || value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value);
const cell = (value: unknown) => {
  const normalized = text(value).replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  // Spreadsheet formulas are executable when a recipient opens the handoff.
  const safe = /^\s*[=+\-@]/.test(normalized) ? `'${normalized}` : normalized;
  return `"${safe.replaceAll('"', '""')}"`;
};

/** Full source-schema rows for a manual data-team import; never an Azure write. */
export const createDataTeamCsv = (relation: DataTeamRelation, rows: DataTeamHandoffRow[]) => {
  const schema = directSourceColumns[relation];
  const output = rows.map(({ sourceRecord, approvedValues }) => {
    const next = { ...sourceRecord };
    for (const [field, value] of Object.entries(approvedValues)) {
      const column = aliases[relation][field] ?? field;
      if (!schema.includes(column)) throw new Error(`Approved field '${field}' is not part of ${relation}.`);
      next[column] = value;
    }
    return schema.map((column) => next[column]);
  });
  return [schema, ...output].map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";
};
