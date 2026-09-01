import type { CheckpointOutcome } from "../../lib/domain/review-workspace.ts";
import type { SiteVerificationReport } from "../../lib/runs/index.ts";

const outcomeCopy: Record<CheckpointOutcome, { label: string; note: string; tone: string }> = {
  verified_no_change: { label: "Keep — no supported change", note: "The audit found no corroborated reason to change this listing.", tone: "keep" },
  candidate_staged: { label: "Review proposed change", note: "Evidence supports a field change. A reviewer must decide it.", tone: "review" },
  conflict: { label: "Review possible closure", note: "Sources conflict. The listing is not removed unless a reviewer approves that decision.", tone: "review" },
  unable_to_verify: { label: "Verification incomplete", note: "Required evidence was unavailable, so this listing remains due for review.", tone: "incomplete" },
  provider_failure: { label: "Provider failed", note: "A provider failed before the audit could finish. No listing change was proposed.", tone: "incomplete" },
  cancelled: { label: "Cancelled", note: "The audit stopped before a decision was produced.", tone: "neutral" },
  budget_exhausted: { label: "Paused — budget reached", note: "The audit needs more approved budget before it can continue.", tone: "neutral" },
  query_completed: { label: "Query cell completed", note: "Discovery results were recorded and eligible leads were queued for review.", tone: "keep" },
  duplicate: { label: "Duplicate location", note: "The lead matched an existing service location.", tone: "keep" },
  possible_duplicate: { label: "Possible duplicate", note: "The lead needs human identity review before it can be treated as new.", tone: "review" },
  out_of_scope: { label: "Out of scope", note: "The lead does not meet the approved service-location scope.", tone: "neutral" },
  not_a_cbo: { label: "Not a CBO", note: "The evidence does not show an eligible community-based organization.", tone: "neutral" },
  insufficient_evidence: { label: "Evidence incomplete", note: "The lead lacks the required corroborating evidence.", tone: "incomplete" },
  not_processed_budget: { label: "Not processed — budget cap", note: "The lead was retained but not processed within the approved campaign cap.", tone: "neutral" }
};

const label = (value: string) => value.replace(/_/g, " ");
const compact = (value: string) => value.replace(/\s+/g, " ").replace(/[`*_>#]/g, "").trim().slice(0, 320);
const sameName = (left: string, right?: string) => !right || left.toLowerCase().replace(/[^a-z0-9]/g, "") === right.toLowerCase().replace(/[^a-z0-9]/g, "");
const safeUrl = (value?: string) => {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined;
  } catch {
    return undefined;
  }
};

export function SiteReports({ reports }: { reports: SiteVerificationReport[] }) {
  const counts = reports.reduce((current, report) => {
    const tone = outcomeCopy[report.outcome].tone;
    current[tone] = (current[tone] ?? 0) + 1;
    return current;
  }, {} as Record<string, number>);

  return <section className="site-reports" id="site-reports" aria-labelledby="site-reports-title">
    <div className="section-heading">
      <div>
        <p className="eyebrow">Audit deliverables</p>
        <h2 id="site-reports-title">Resource reports</h2>
        <p>Every checked listing receives a durable result, including listings with no proposed change.</p>
      </div>
      {reports.length ? <div className="report-summary" aria-label="Resource report summary">
        <span><strong>{counts.keep ?? 0}</strong> keep</span>
        <span><strong>{counts.review ?? 0}</strong> review</span>
        <span><strong>{counts.incomplete ?? 0}</strong> incomplete</span>
      </div> : null}
    </div>

    {reports.length ? <ul className="site-report-list">
      {reports.map((report) => {
        const copy = outcomeCopy[report.outcome];
        return <li className={`site-report report-${copy.tone}`} key={`${report.runId}-${report.resourceId}`}>
          <div className="site-report-main">
            <div>
              <h3>{report.resourceName}</h3>
              <p>{copy.note}</p>
            </div>
            <span className={`result-chip result-${copy.tone}`}>{copy.label}</span>
          </div>
          <div className="site-report-meta">
            <span>{new Date(report.completedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Chicago" })}</span>
            <span>Run {report.runId.slice(0, 8)}</span>
            {report.evidence.advisory?.cboEligibility ? <span>AI eligibility: {label(report.evidence.advisory.cboEligibility)}</span> : null}
          </div>
          <details>
            <summary>View evidence and reasoning</summary>
            <div className="report-detail">
              <h4>Why this result</h4>
              <ul>{report.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
              {report.providerIssues.length ? <p className="provider-warning"><strong>Provider issues:</strong> {report.providerIssues.map(label).join(", ")}</p> : null}
              <h4>Sources checked</h4>
              {report.evidence.observations.length ? <ul className="evidence-list">
                {report.evidence.observations.map((observation, index) => {
                  const source = safeUrl(observation.sourceUrl);
                  const identityMismatch = !sameName(report.resourceName, observation.values?.name);
                  return <li key={`${observation.provider}-${observation.observedAt}-${index}`}>
                    <strong>{label(observation.provider)}</strong> — {label(observation.state)}
                    {source ? <> · <a href={source} target="_blank" rel="noreferrer">open source</a></> : null}
                    {identityMismatch ? <p className="identity-warning"><strong>Different organization returned.</strong> This result is not valid evidence for this listing.</p> : null}
                    {observation.values && Object.keys(observation.values).length ? <dl className="evidence-facts">
                      {Object.entries(observation.values).filter(([, value]) => value).map(([key, value]) => <div key={key}><dt>{label(key)}</dt><dd>{value}</dd></div>)}
                    </dl> : null}
                    {observation.excerpt ? <details className="evidence-excerpt"><summary>Captured text</summary><p>{compact(observation.excerpt)}</p></details> : null}
                  </li>;
                })}
              </ul> : <p>No detailed source capture was retained for this older run.</p>}
              {report.evidence.advisory?.rationale ? <><h4>AI advisory</h4><p>{report.evidence.advisory.rationale}</p></> : null}
              {report.candidateId ? <p><a className="review-link" href={`/review/${report.candidateId}`}>Open the human review decision →</a></p> : null}
            </div>
          </details>
        </li>;
      })}
    </ul> : <div className="empty-report">
      <p><strong>No resource reports yet.</strong></p>
      <p>Select a current listing above and run an audit. Its result will appear here whether it is kept, needs review, or could not be verified.</p>
    </div>}
  </section>;
}
