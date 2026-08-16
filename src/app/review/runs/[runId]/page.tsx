import { UserButton } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { hasWorkspaceRole } from "../../../../lib/db.ts";
import { runRegistry } from "../../../../lib/runs/index.ts";
import { RunActions } from "../../run-actions.tsx";
import { SiteReports } from "../../site-reports.tsx";

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
  const page = Math.max(1, Math.trunc(Number(typeof pageValue === "string" ? pageValue : 1)) || 1);
  const pageSize = 50;
  const reports = await runRegistry.listRecentSiteReports(pageSize + 1, run.id, (page - 1) * pageSize);
  const hasNext = reports.length > pageSize;
  const visibleReports = reports.slice(0, pageSize);
  const remaining = Math.max(0, run.selection.length - run.report.recordsChecked);
  const resumeHeadroom = Math.max(0, run.selection.length - run.budget);

  return <main className="work-surface">
    <header className="app-header"><div><p className="brand">ChicagoHealthMap</p><p className="brand-sub">CBO verification</p></div><UserButton /></header>
    <section className="page-intro">
      <p className="eyebrow">Durable audit run</p>
      <h1>Audit run</h1>
      <p>{label(run.mode)} · {label(run.status)}</p>
      <p><strong>{run.report.recordsChecked}</strong> checked · <strong>{remaining}</strong> Remaining · <strong>{run.report.candidatesStaged}</strong> proposed changes · <strong>{run.report.unableToVerify + run.report.providerFailures}</strong> incomplete</p>
      <p><a href="/review">Back to the audit workspace</a></p>
    </section>
    <RunActions runId={run.id} status={run.status} resumeHeadroom={resumeHeadroom} />
    <SiteReports reports={visibleReports} />
    <nav className="actions" aria-label="Resource report pages">
      {page > 1 ? <a className="primary-button" href={`/review/runs/${run.id}?page=${page - 1}`}>Previous reports</a> : null}
      {hasNext ? <a className="primary-button" href={`/review/runs/${run.id}?page=${page + 1}`}>More reports</a> : null}
    </nav>
  </main>;
}
