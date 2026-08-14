import type { CalibrationSummary as Calibration } from "../../lib/verification/calibration.ts";

export function CalibrationSummary({ summaries }: { summaries: Calibration[] }) {
  return <section className="queue-panel" aria-labelledby="calibration-title">
    <h2 id="calibration-title">Advisory calibration</h2>
    <p>Agreement requires a separately recorded reviewer CBO-eligibility label; approval or rejection of a field change is not that label. These aggregates do not change verification policy.</p>
    {summaries.length ? <ul className="evidence-list">{summaries.map((summary) => <li key={summary.promptVersion}><strong>{summary.promptVersion}</strong>: {summary.reviewed} reviewed · {summary.aligned}/{summary.comparable} explicitly labeled agreements · {summary.disagreed} disagreements · {summary.insufficientEvidence} insufficient evidence · {summary.deferred} deferred</li>)}</ul> : <p className="empty-queue">No reviewed advisory records yet.</p>}
  </section>;
}
