import type { VerificationRun } from "../../lib/runs/index.ts";

const label = (value: string) => value.replace(/_/g, " ");

export function RunStatus({ runs }: { runs: VerificationRun[] }) {
  return <section className="queue-panel" aria-labelledby="run-status-title">
    <h2 id="run-status-title">Run history</h2>
    <p>Operational history for troubleshooting. Use Resource reports above for the outcome of each listing.</p>
    {runs.length ? <ul className="candidate-list">
      {runs.map((run) => <li key={run.id} className="candidate-row">
        <div className="candidate-main"><span>{label(run.status)}</span><span className={`status-chip status-${run.status}`}>{run.checkpoint} / {run.selection.length}</span></div>
        <p className="candidate-meta">{run.report.recordsChecked} checked · {run.report.candidatesStaged} candidate(s) · {run.report.conflicts} conflict(s) · {run.report.unableToVerify} unable to verify · {run.report.providerFailures} provider failure(s)</p>
      </li>)}
    </ul> : <p className="empty-queue">No verification runs have been recorded.</p>}
  </section>;
}
