import type { ReviewDecisionRecord } from "../../lib/repositories/review.ts";

export function ReviewHistory({ decisions }: { decisions: ReviewDecisionRecord[] }) {
  return <section className="detail-panel" aria-labelledby="history-title">
    <h2 id="history-title">Decision history</h2>
    {decisions.length ? <ol className="evidence-list">{decisions.map((decision, index) => <li key={`${decision.at}-${index}`}><strong>{decision.action.replace(/_/g, " ")}</strong> · {decision.at}<br />{decision.reason}{decision.fields?.length ? ` · fields: ${decision.fields.join(", ")}` : ""}</li>)}</ol> : <p>No human decision has been recorded for this revision.</p>}
  </section>;
}
