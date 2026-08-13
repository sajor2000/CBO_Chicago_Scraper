import { createAzureSqlPatch, type ApprovedChange, type AzureSqlMapping } from "./azure-sql.ts";

export const azureMappingFromEnv = (): AzureSqlMapping => {
  const value = process.env.AZURE_EXPORT_MAPPING_JSON;
  if (!value) throw new Error("Azure export is disabled until AZURE_EXPORT_MAPPING_JSON is configured from the approved production contract.");
  try {
    const mapping = JSON.parse(value) as AzureSqlMapping;
    if (!mapping.table || !mapping.idColumn || !mapping.versionColumn || !mapping.fields || typeof mapping.fields !== "object") throw new Error("missing required mapping fields");
    return mapping;
  } catch (error) {
    throw new Error(`Azure export mapping is invalid: ${error instanceof Error ? error.message : "unknown error"}`);
  }
};

export const exportApprovedChanges = (changes: ApprovedChange[]) => createAzureSqlPatch({ mapping: azureMappingFromEnv(), changes });
