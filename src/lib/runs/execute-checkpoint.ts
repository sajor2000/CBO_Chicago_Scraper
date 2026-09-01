import { discoveryEvidenceFromEnv, hostedEvidenceFromEnv } from "../providers/hosted-evidence.ts";
import { ExaClient, GooglePlacesClient } from "../providers/index.ts";
import { discoveryEvidenceGate, resolveDiscoveryLead, retryableDiscoveryState } from "../discovery/index.ts";
import { reviewProvenance, reviewRepository } from "../repositories/review.ts";
import type { CapturedObservation } from "../retrieval/types.ts";
import { processVerificationCheckpoint, referenceResourceFromSnapshot } from "../verification/run-checkpoint.ts";
import { runRegistry, type RunReport } from "./index.ts";

export type CheckpointResult = Pick<RunReport, "recordsChecked" | "candidatesStaged" | "conflicts" | "unableToVerify" | "providerFailures" | "budgetUsed"> & {
  message?: string;
  done: boolean;
  runStatus?: string;
  state?: string;
  reasons?: string[];
  providerIssues?: string[];
  resourceId?: string;
  resourceName?: string;
};

const blankStep = (): Pick<RunReport, "recordsChecked" | "candidatesStaged" | "conflicts" | "unableToVerify" | "providerFailures" | "budgetUsed"> => ({
  recordsChecked: 0, candidatesStaged: 0, conflicts: 0, unableToVerify: 0, providerFailures: 0, budgetUsed: 0
});

const within = <T,>(work: Promise<T>, milliseconds: number, label: string): Promise<T> => new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error(`${label} timed out.`)), milliseconds);
  work.then(resolve, reject).finally(() => clearTimeout(timeout));
});

export function providerIssuesFor(observations: CapturedObservation[], advisoryError?: unknown): string[] {
  const issues = observations
    .filter((observation) => observation.state !== "success" && observation.state !== "no_result")
    .map((observation) => `${observation.provider}:${observation.state}`);
  if (!advisoryError) return issues;
  const message = advisoryError instanceof Error ? advisoryError.message : "";
  const httpStatus = message.match(/request failed \((\d{3})\)/)?.[1];
  const state = /timed out/i.test(message) ? "timeout"
    : httpStatus ? `http_${httpStatus}`
      : /response|structured|invalid|JSON/i.test(message) ? "malformed" : "unavailable";
  return [...issues, `azure_openai:${state}`];
}

export async function recoverCheckpointFailure(
  registry: Pick<typeof runRegistry, "failCheckpoint" | "releaseLease">,
  runId: string,
  leaseToken: string,
  attempt: number
): Promise<void> {
  if (attempt >= 3) {
    try {
      await registry.failCheckpoint(runId, leaseToken);
      return;
    } catch { /* release below so a failed state transition remains retryable */ }
  }
  try { await registry.releaseLease(runId, leaseToken); } catch { /* preserve the original execution error */ }
}

/** Executes one leased checkpoint; callers own authorization and HTTP response mapping. */
export async function executeCheckpoint(runId: string): Promise<CheckpointResult> {
  let leaseToken: string | undefined;
  let resourceId: string | undefined;
  let resourceName: string | undefined;
  let attempt = 0;
  let discoveryCheckpoint = false;
  try {
    const claim = await runRegistry.claimNext(runId);
    if (!claim) {
      const run = await runRegistry.get(runId);
      const message = run?.status === "cancelled" ? "This run was cancelled."
        : run?.status === "completed" ? "This run has no remaining checkpoints."
          : "No checkpoint is available.";
      return { message, done: true, ...blankStep(), runStatus: run?.status };
    }
    leaseToken = claim.leaseToken;
    resourceId = claim.resourceId;
    attempt = claim.attempt;
    if (claim.discoveryQueryCellId) {
      discoveryCheckpoint = true;
      const cell = await runRegistry.discoveryQueryCell(claim.discoveryQueryCellId);
      if (!cell || cell.runId !== runId) throw new Error("Discovery query checkpoint has no durable query cell.");
      if (!await runRegistry.consumeDiscoveryProviderCall(runId)) throw new Error("Discovery provider-call budget is exhausted.");
      const observations = cell.provider === "google_places"
        ? await new GooglePlacesClient({ apiKey: process.env.GOOGLE_MAPS_API_KEY ?? "" }).discovery(cell.query, cell.resultCap)
        : await new ExaClient({ apiKey: process.env.EXA_API_KEY ?? "" }).discovery(cell.query, cell.resultCap);
      if (observations.length && observations.every((observation) => retryableDiscoveryState(observation.state))) {
        if (await runRegistry.retryDiscoveryCheckpoint(runId, claim.leaseToken)) {
          leaseToken = undefined;
          return { ...blankStep(), state: "retry_wait", message: "Discovery provider retry scheduled.", done: false, runStatus: "queued" };
        }
      }
      await runRegistry.completeDiscoveryQueryCell({ runId, queryCellId: cell.id, leaseToken: claim.leaseToken, observations });
      leaseToken = undefined;
      const runStatus = await runRegistry.status(runId);
      return { ...blankStep(), state: "query_completed", done: runStatus === "completed" || runStatus === "cancelled", runStatus };
    }
    if (claim.discoveryLeadId) {
      discoveryCheckpoint = true;
      const durableLead = await reviewRepository.discoveryLead(claim.discoveryLeadId);
      if (!durableLead || durableLead.runId !== runId) throw new Error("Discovery lead checkpoint has no durable lineage.");
      const resolution = resolveDiscoveryLead(durableLead.lead, await reviewRepository.discoveryExistingLocations(), ["Cook", "DuPage", "Kane", "Kendall", "Lake", "McHenry", "Will"]);
      let outcome: "candidate_staged" | "duplicate" | "possible_duplicate" | "out_of_scope" | "not_a_cbo" | "insufficient_evidence" | "provider_failure" = resolution.disposition === "not_processed_budget" ? "insufficient_evidence" : resolution.disposition;
      let reasons = resolution.reasons;
      let observations: CapturedObservation[] = [];
      if (resolution.disposition === "insufficient_evidence" && !resolution.matchedIds.length) {
        if (!await runRegistry.consumeDiscoveryProviderCall(runId)) throw new Error("Discovery provider-call budget is exhausted.");
        observations = await within(discoveryEvidenceFromEnv().collect(durableLead.lead), 30_000, "Discovery evidence collection");
        const independentSources = new Set(observations.filter((observation) => observation.state === "success" && (observation.provider === "irs" || observation.provider === "trusted_directory")).map((observation) => observation.provider)).size;
        outcome = discoveryEvidenceGate(durableLead.lead, observations, independentSources, observations.some((observation) => observation.provider === "firecrawl" && observation.state === "success"));
        reasons = outcome === "candidate_staged"
          ? ["The lead has an exact in-scope address and passed the independent evidence gate."]
          : outcome === "provider_failure" ? ["Required discovery evidence providers failed before corroboration completed."]
            : ["The lead did not meet the independent corroboration gate."];
        if (outcome === "candidate_staged") {
          await reviewRepository.stageDiscoveryCandidate({
            leadId: durableLead.id,
            lineageId: durableLead.lineageId,
            runId,
            leaseToken: claim.leaseToken,
            proposedValues: Object.fromEntries(Object.entries({ name: durableLead.lead.name, address: durableLead.lead.address, county: durableLead.lead.county, phone: durableLead.lead.phone, url: durableLead.lead.url }).filter((entry): entry is [string, string] => Boolean(entry[1]))),
            observations
          });
        }
      }
      await runRegistry.completeDiscoveryLead({ runId, leadId: durableLead.id, leaseToken: claim.leaseToken, outcome, reasons });
      leaseToken = undefined;
      const runStatus = await runRegistry.status(runId);
      return {
        recordsChecked: 1,
        candidatesStaged: outcome === "candidate_staged" ? 1 : 0,
        conflicts: outcome === "possible_duplicate" ? 1 : 0,
        unableToVerify: outcome === "insufficient_evidence" ? 1 : 0,
        providerFailures: outcome === "provider_failure" ? 1 : 0,
        budgetUsed: 1,
        state: outcome, reasons, resourceId: durableLead.id, resourceName: durableLead.lead.name,
        done: runStatus === "completed" || runStatus === "cancelled", runStatus
      };
    }
    if (!claim.resourceId) throw new Error("Checkpoint has no executable target.");
    const hostedEvidence = hostedEvidenceFromEnv();
    const seeded = await reviewRepository.seededResource(claim.resourceId, claim.snapshotId);
    if (!seeded) throw new Error("Selected resource has no seeded public snapshot.");
    const resource = referenceResourceFromSnapshot(seeded);
    resourceName = resource.name;
    const observations: CapturedObservation[] = await within(hostedEvidence.collect(resource), 30_000, "Evidence collection");
    let advisoryError: unknown;
    const advisory = await within(hostedEvidence.score(resource, observations), 25_000, "Evidence scoring").catch((error) => {
      advisoryError = error;
      return undefined;
    });
    const providerIssues = providerIssuesFor(observations, advisoryError);
    if (providerIssues.length) console.warn("Verification provider issues", { runId, resourceId: claim.resourceId, providerIssues });
    if (!advisory) {
      await runRegistry.completeCheckpoint(runId, claim.leaseToken, { providerFailures: 1 }, "provider_failure", {
        resourceName,
        verificationState: "provider_failure",
        reasons: ["AI advisory output was unavailable or invalid, so no AI-guided conclusion was used."],
        providerIssues,
        evidence: reviewProvenance({ observations })
      });
      leaseToken = undefined;
      const runStatus = await runRegistry.status(runId);
      return { recordsChecked: 1, candidatesStaged: 0, conflicts: 0, unableToVerify: 0, providerFailures: 1, budgetUsed: 1,
        state: "provider_failure", reasons: ["AI advisory output was unavailable or invalid, so no AI-guided conclusion was used."], providerIssues, resourceId, resourceName,
        done: runStatus === "completed" || runStatus === "cancelled", runStatus };
    }
    const output = await processVerificationCheckpoint({
      resource,
      observations,
      advisory,
      stage: (candidate) => reviewRepository.stageVerification({ resourceId: resource.id, runId, leaseToken: claim.leaseToken, ...candidate })
    });
    await runRegistry.completeCheckpoint(runId, claim.leaseToken, output.report, output.outcome, {
      resourceName: resource.name,
      verificationState: output.result.state,
      reasons: output.result.reasons,
      providerIssues,
      evidence: reviewProvenance({ observations: output.result.observations, advisory: output.result.advisory })
    });
    leaseToken = undefined;
    const runStatus = await runRegistry.status(runId);
    return {
      recordsChecked: 1, budgetUsed: 1,
      candidatesStaged: output.report.candidatesStaged ?? 0,
      conflicts: output.report.conflicts ?? 0,
      unableToVerify: output.report.unableToVerify ?? 0,
      providerFailures: output.report.providerFailures ?? 0,
      state: output.result.state, reasons: output.result.reasons, providerIssues, resourceId: claim.resourceId,
      done: runStatus === "completed" || runStatus === "cancelled", runStatus, resourceName: resource.name
    };
  } catch (error) {
    const retryable = error instanceof Error && (/timed out|429|5\d\d|unavailable/i.test(error.message));
    if (leaseToken && discoveryCheckpoint && retryable && await runRegistry.retryDiscoveryCheckpoint(runId, leaseToken)) leaseToken = undefined;
    if (leaseToken) await recoverCheckpointFailure(runRegistry, runId, leaseToken, attempt);
    throw error;
  }
}
