import { directSourceColumns, sourceRelations, type SourceRelation } from "../imports/cbo-baseline.ts";

export const dataTeamRelations = sourceRelations;
export type DataTeamRelation = SourceRelation;

const aliases: Record<DataTeamRelation, Record<string, string>> = {
  community_resource_locations: { address: "full_address", website: "hyperlink", name: "organization_name" },
  wic_locations: { address: "full_address", name: "location_name" }
};

export type DataTeamHandoffRow = { sourceRecord: Record<string, unknown>; approvedValues: Record<string, string> };

export class DataTeamCsvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataTeamCsvError";
  }
}

export const isDataTeamRelation = (value: string | null): value is DataTeamRelation => dataTeamRelations.includes(value as DataTeamRelation);
const text = (value: unknown) => value === null || value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value);
const cell = (value: unknown) => {
  const normalized = text(value).replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  // Spreadsheet formulas are executable when a recipient opens the handoff.
  const safe = typeof value === "string" && /^\s*[=+\-@]/.test(normalized) ? `'${normalized}` : normalized;
  return `"${safe.replaceAll('"', '""')}"`;
};

function parseCsv(csv: string) {
  const rows: string[][] = [];
  let index = 0;
  while (index < csv.length) {
    const row: string[] = [];
    while (true) {
      if (csv[index] !== '"') throw new DataTeamCsvError("CSV cells must be quoted.");
      index += 1;
      let value = "";
      while (index < csv.length) {
        if (csv[index] !== '"') {
          value += csv[index++]!;
        } else if (csv[index + 1] === '"') {
          value += '"';
          index += 2;
        } else {
          index += 1;
          break;
        }
      }
      if (index > csv.length) throw new DataTeamCsvError("CSV contains an unterminated quoted cell.");
      row.push(value);
      if (csv[index] === ",") {
        index += 1;
        continue;
      }
      if (csv[index] === "\r" && csv[index + 1] === "\n") {
        index += 2;
        rows.push(row);
        break;
      }
      throw new DataTeamCsvError("CSV cells must end with a comma or CRLF.");
    }
  }
  return rows;
}

const requiredKeys: Record<DataTeamRelation, readonly string[]> = {
  community_resource_locations: ["id"],
  wic_locations: ["wic_id", "location_name", "longitude", "latitude"]
};

export function validateDataTeamCsv(relation: DataTeamRelation, csv: string, expectedRowCount: number) {
  const schema = directSourceColumns[relation];
  const parsed = parseCsv(csv);
  if (parsed.length !== expectedRowCount + 1 || parsed[0]?.join("\u0000") !== schema.join("\u0000")) {
    throw new DataTeamCsvError("CSV header or row count does not match the source schema.");
  }
  const geomIndex = schema.indexOf("geom");
  for (const row of parsed.slice(1)) {
    if (row.length !== schema.length || row[geomIndex] !== "") throw new DataTeamCsvError("CSV rows must match the source schema and leave geom blank.");
    if (requiredKeys[relation].some((key) => row[schema.indexOf(key)] === "")) throw new DataTeamCsvError("CSV is missing a required source key.");
  }
}

/** Full source-schema rows for a manual data-team import; never an Azure write. */
export const createDataTeamCsv = (relation: DataTeamRelation, rows: DataTeamHandoffRow[]) => {
  const schema = directSourceColumns[relation];
  const output = rows.map(({ sourceRecord, approvedValues }) => {
    if (sourceRecord.geom !== undefined || approvedValues.geom !== undefined) {
      throw new DataTeamCsvError("geom must remain blank in data-team CSV handoffs.");
    }
    const next = { ...sourceRecord };
    for (const [field, value] of Object.entries(approvedValues)) {
      const column = aliases[relation][field] ?? field;
      if (!schema.includes(column)) throw new DataTeamCsvError(`Approved field '${field}' is not part of ${relation}.`);
      next[column] = value;
    }
    return schema.map((column) => next[column]);
  });
  const csv = [schema, ...output].map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";
  validateDataTeamCsv(relation, csv, rows.length);
  return csv;
};
