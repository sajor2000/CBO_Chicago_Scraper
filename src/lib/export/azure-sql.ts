import { createHash } from "node:crypto";

export interface AzureSqlMapping {
  table: string;
  idColumn: string;
  versionColumn: string;
  fields: Record<string, string>;
}

export interface ApprovedChange {
  candidateId: string;
  targetId: string;
  expectedVersion: string;
  approvedValues: Record<string, string>;
  evidenceIds: string[];
  decisionId: string;
}

export class ExportContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExportContractError";
  }
}

const identifier = (value: string) => {
  if (!/^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?$/i.test(value)) throw new ExportContractError("Export mapping contains an unsafe SQL identifier.");
  return value;
};

const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;

export const createAzureSqlPatch = (input: { mapping?: AzureSqlMapping; changes: ApprovedChange[] }) => {
  const mapping = input.mapping;
  if (!mapping) throw new ExportContractError("Azure export is disabled until an authoritative production mapping is configured.");
  const table = identifier(mapping.table);
  const idColumn = identifier(mapping.idColumn);
  const versionColumn = identifier(mapping.versionColumn);
  const statements = input.changes.map((change) => {
    const sets = Object.entries(change.approvedValues).map(([field, value]) => {
      const targetColumn = mapping.fields[field];
      if (!targetColumn) throw new ExportContractError(`Approved field '${field}' is not allowlisted for Azure export.`);
      return `${identifier(targetColumn)} = ${literal(value)}`;
    });
    if (!sets.length) throw new ExportContractError("An Azure export change must contain at least one approved field.");
    return `update ${table}\nset ${sets.join(", ")}\nwhere ${idColumn} = ${literal(change.targetId)}\n  and ${versionColumn} = ${literal(change.expectedVersion)};\n\nif not found then\n  raise exception 'Azure export target drift for candidate ${change.candidateId}';\nend if;`;
  });
  const sql = ["begin;", "do $$", "begin", ...statements.map((statement) => `  ${statement.replaceAll("\n", "\n  ")}`), "end $$;", "commit;", ""].join("\n");
  return {
    sql,
    manifest: {
      changeCount: input.changes.length,
      sha256: createHash("sha256").update(sql).digest("hex"),
      candidates: input.changes.map(({ candidateId, decisionId, evidenceIds }) => ({ candidateId, decisionId, evidenceIds }))
    }
  };
};
