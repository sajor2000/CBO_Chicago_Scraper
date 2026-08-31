import { UserButton } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { hasWorkspaceRole } from "../../../../lib/db.ts";
import { runRegistry } from "../../../../lib/runs/index.ts";
import { RunActions } from "../../run-actions.tsx";
import { SiteReports } from "../../site-reports.tsx";
import { discoveryRepository } from "../../../../lib/discovery/repository.ts";

const label = (value: string) => value.replace(/_/g, " ");

export default async function RunPage({ params, searchParams }: { params: Promise<{ runId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { userId } = await auth();
  const runId = (await params).runId;
  if (!userId || !(await hasWorkspaceRole(userId, "operator"))) {
    return <main className="work-surface"><p className="empty-queue">Operator access is required to view this audit run.</p></main>;
  }
  const run = await runRegistry.get(runId);
  if (!run) return <main className="work-surface"><p className="empty-queue">Audit run not found.</p></main>;
  const pageValue = (await searchParams).page;
  const dispositionValue = (await searchParams).disposition;
  const disposition = typeof dispositionValue === "string" && ["candidate_staged","duplicate","possible_duplicate","out_of_scope","not_a_cbo","insufficient_evidence","provider_failure","not_processed_budget"].includes(dispositionValue) ? dispositionValue as Parameters<typeof discoveryRepository.listDispositions>[3] : undefined;
  const page = Math.max(1, Math.trunc(Number(typeof pageValue === "string" ? pageValue : 1)) || 1);
  const pageSize = 50;
  const reports = await runRegistry.listRecentSiteReports(pageSize + 1, run.id, (page - 1) * pageSize);
  const hasNext = reports.length > pageSize;
  const visibleReports = reports.slice(0, pageSize);
  const discoveryReport = run.mode === "discovery_only" ? await discoveryRepository.report(run.id) : undefined;
  const discoveryRows = run.mode === "discovery_only" ? await discoveryRepository.listDispositions(run.id, pageSize + 1, (page - 1) * pageSize, disposition) : [];
  const discoveryWork = run.mode === "discovery_only" ? await discoveryRepository.workState(run.id) : undefined;
  const discoveryHasNext = discoveryRows.length > pageSize;
  const remaining = Math.max(0, run.selection.length - run.report.recordsChecked);
  const resumeHeadroom = Math.max(0, run.selection.length - run.budget);

  return <main className="work-surface">
    <header className="app-header"><div><p className="brand">ChicagoHealthMap</p><p className="brand-sub">CBO verification</p></div><UserButton /></header>
    <section className="page-intro">
      <p className="eyebrow">Durable audit run</p>
      <h1>Audit run</h1>
      <p>{label(run.mode)} · {label(run.status)}</p>
      {run.mode !== "discovery_only" ? <p><strong>{run.report.recordsChecked}</strong> checked · <strong>{remaining}</strong> Remaining · <strong>{run.report.candidatesStaged}</strong> proposed changes · <strong>{run.report.unableToVerify + run.report.providerFailures}</strong> incomplete</p> : null}
      {discoveryReport ? <p><strong>{(discoveryWork?.pending??0)+(discoveryWork?.retryWaiting??0)+(discoveryWork?.leased??0)}</strong> remaining/retrying · <strong>{discoveryReport.queryCellsCompleted}/{discoveryReport.queryCells}</strong> query cells · <strong>{discoveryReport.normalizedLeads}</strong> normalized leads · <strong>{discoveryReport.deduplicatedLeads}</strong> decided leads · <strong>{discoveryReport.candidatesStaged}</strong> staged · <strong>{discoveryReport.possibleDuplicates}</strong> possible duplicates · <strong>{discoveryReport.providerFailures}</strong> provider failures · <strong>{discoveryReport.zeroYieldCells}</strong> zero-yield cells · <strong>{discoveryReport.providerCallsUsed}/{discoveryReport.providerCallBudget}</strong> provider calls · <strong>{discoveryReport.deduplicatedLeads ? Math.round(discoveryReport.candidatesStaged/discoveryReport.deduplicatedLeads*100) : 0}%</strong> credible-lead yield</p> : null}
      <p><a href="/review">Back to the audit workspace</a></p>
    </section>
    <RunActions runId={run.id} status={run.status} resumeHeadroom={resumeHeadroom} fixedProviderBudget={run.mode === "discovery_only"} />
    {run.mode === "discovery_only" ? <section className="queue-panel" aria-labelledby="lead-results-title"><h2 id="lead-results-title">Discovery dispositions</h2><form action={`/review/runs/${run.id}`}><label>Disposition <select name="disposition" defaultValue={disposition??""}><option value="">All</option>{["candidate_staged","duplicate","possible_duplicate","out_of_scope","not_a_cbo","insufficient_evidence","provider_failure","not_processed_budget"].map((value)=><option key={value} value={value}>{label(value)}</option>)}</select></label><button type="submit">Filter</button></form>{discoveryRows.length ? <ul className="candidate-list">{discoveryRows.slice(0,pageSize).map((lead) => <li key={`${lead.evaluationId}-${lead.recordedAt}`} className="candidate-row"><div className="candidate-main">{lead.candidateId ? <a href={`/review/${lead.candidateId}`}>{lead.name}</a> : <strong>{lead.name}</strong>}<span className={`status-chip status-${lead.disposition}`}>{label(lead.disposition)}</span></div><p className="candidate-meta">{[lead.address,lead.county,...lead.reasons].filter(Boolean).join(" · ")}{lead.advisoryState === "advisory_unavailable" ? " · AI advisory unavailable" : ""}</p></li>)}</ul> : <p>No lead dispositions have been recorded yet.</p>}</section> : <SiteReports reports={visibleReports} />}
    <nav className="actions" aria-label="Resource report pages">
      {page > 1 ? <a className="primary-button" href={`/review/runs/${run.id}?page=${page - 1}${disposition?`&disposition=${disposition}`:""}`}>Previous reports</a> : null}
      {(run.mode === "discovery_only" ? discoveryHasNext : hasNext) ? <a className="primary-button" href={`/review/runs/${run.id}?page=${page + 1}${disposition?`&disposition=${disposition}`:""}`}>More reports</a> : null}
    </nav>
  </main>;
}
