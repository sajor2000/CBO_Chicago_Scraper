import type { ReviewDecisionRecord } from "../../lib/repositories/review.ts";

export function ReviewHistory({ decisions }: { decisions: ReviewDecisionRecord[] }) {
  return <section className="detail-panel" aria-labelledby="history-title">
    <h2 id="history-title">Review history</h2>
    {decisions.length ? <ol className="evidence-list">{decisions.map((decision, index) => <li key={`${decision.at}-${index}`}><strong>{decision.action.replace(/_/g, " ")}</strong> · {decision.at}<br />{decision.reason}{decision.fields?.length ? ` · fields: ${decision.fields.join(", ")}` : ""}{decision.cboEligibility !== undefined ? ` · CBO: ${decision.cboEligibility ? "eligible" : "not eligible"}` : ""}</li>)}</ol> : <p>No human review activity has been recorded for this candidate.</p>}
  </section>;
}
