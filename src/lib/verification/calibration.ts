import type { AiAdvisory } from "./index.ts";

export type CalibrationRecord = Pick<AiAdvisory, "promptVersion" | "cboEligibility"> & { decision: "approved" | "rejected" | "deferred"; reviewerCboEligibility?: boolean };
export type CalibrationSummary = { promptVersion: string; reviewed: number; comparable: number; aligned: number; disagreed: number; insufficientEvidence: number; deferred: number };

/** Aggregates only final human decisions; it never influences verification policy. */
export const summarizeCalibration = (records: CalibrationRecord[]): CalibrationSummary[] => {
  const summaries = new Map<string, CalibrationSummary>();
  for (const record of records) {
    if (!record.promptVersion) continue;
    const summary = summaries.get(record.promptVersion) ?? { promptVersion: record.promptVersion, reviewed: 0, comparable: 0, aligned: 0, disagreed: 0, insufficientEvidence: 0, deferred: 0 };
    summary.reviewed += 1;
    if (record.decision === "deferred") summary.deferred += 1;
    else if (record.cboEligibility === "insufficient_evidence" || !record.cboEligibility) summary.insufficientEvidence += 1;
    else if (record.reviewerCboEligibility !== undefined) {
      summary.comparable += 1;
      const aligned = (record.cboEligibility !== "not_a_cbo") === record.reviewerCboEligibility;
      if (aligned) summary.aligned += 1;
      else summary.disagreed += 1;
    }
    summaries.set(record.promptVersion, summary);
  }
  return [...summaries.values()].sort((a, b) => a.promptVersion.localeCompare(b.promptVersion));
};
