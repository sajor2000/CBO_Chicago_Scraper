import { UserButton } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { hasWorkspaceRole, WorkspaceTargetError } from "../../lib/db.ts";
import { reviewRepository } from "../../lib/repositories/review.ts";
import { runRegistry } from "../../lib/runs/index.ts";
import { verificationReadiness } from "../../lib/verification/readiness.ts";
import { RunControls } from "./run-controls.tsx";
import { RunStatus } from "./run-status.tsx";

const fieldLabel = (field: string) => field.replace(/_/g, " ");
const statusLabel = (status: string) => status.replace(/_/g, " ");

function AppHeader() {
  return <header className="app-header">
    <div>
      <p className="brand">ChicagoHealthMap</p>
      <p className="brand-sub">CBO verification</p>
    </div>
    <UserButton />
  </header>;
}

function AuthGate({ title, body, href, linkLabel }: { title: string; body: string; href: string; linkLabel: string }) {
  return <main className="work-surface">
    <AppHeader />
    <section className="state-panel">
      <h1>{title}</h1>
      <p>{body}</p>
      <p><a href={href}>{linkLabel}</a></p>
    </section>
  </main>;
}

export default async function ReviewQueuePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { userId } = await auth();
  if (!userId) {
    return <AuthGate title="Sign in required" body="Open the review workspace with a ChicagoHealthMap Clerk account." href="/sign-in" linkLabel="Go to sign in" />;
  }

  let isReviewer = false;
  let isOperator = false;
  try {
    isReviewer = await hasWorkspaceRole(userId, "reviewer");
    isOperator = await hasWorkspaceRole(userId, "operator");
  } catch (error) {
    if (error instanceof WorkspaceTargetError) {
      return <AuthGate title="Workspace unavailable" body="REVIEW_DATABASE_URL must point at the dedicated review workspace before the queue can load." href="/review" linkLabel="Retry" />;
    }
    throw error;
  }

  if (!isReviewer && !isOperator) {
    return <AuthGate
      title="Access denied"
      body="Your account is signed in but is not granted reviewer or operator access in the dedicated review workspace."
      href="/sign-in"
      linkLabel="Switch account"
    />;
  }

  const filters = await searchParams;
  const text = (key: string) => typeof filters[key] === "string" ? filters[key] : undefined;
  const candidates = isReviewer ? await reviewRepository.list({ status: text("status") as "staged" | "deferred" | "rejected" | "approved" | undefined, kind: text("kind") as "update" | "closure_review" | "new_resource" | undefined, evidenceQuality: text("evidenceQuality") as "high" | "medium" | "low" | undefined }) : [];
  let resources: Array<{ id: string; name: string }> = [];
  let runs: Awaited<ReturnType<typeof runRegistry.listRecent>> = [];
  let readiness: Awaited<ReturnType<typeof verificationReadiness>> | undefined;
  if (isOperator) {
    readiness = await verificationReadiness();
    if (readiness.ready) {
      resources = await reviewRepository.listSeededResources(100);
      runs = await runRegistry.listRecent();
    }
  }

  return <main className="work-surface">
    <AppHeader />
    <section className="page-intro">
      <h1>{isReviewer ? "Reviewer queue" : "Operator pilot"}</h1>
      <p>
        {isReviewer
          ? "Review staged evidence and approve only the supported field changes. Nothing here publishes to ChicagoHealthMap production."
          : "Launch a bounded evidence check. You need a reviewer grant to open staged candidates."}
      </p>
    </section>

    {isOperator && (
      !readiness?.ready
        ? <section className="pilot-panel" aria-labelledby="pilot-title">
          <h2 id="pilot-title">Run a small evidence check</h2>
          <p className="pilot-empty">Verification is blocked until all readiness checks pass.</p>
          <ul className="readiness-list">{readiness?.checks.filter((check) => !check.ready).map((check) => <li key={check.name}><strong>{check.name}:</strong> {check.message}</li>)}</ul>
        </section>
        : <RunControls resources={resources} />
    )}

    {isOperator && <RunStatus runs={runs} />}

    {isReviewer ? (
      <section className="queue-panel" aria-labelledby="queue-title">
        <h2 id="queue-title">Staged candidates</h2>
        <form className="queue-filters" action="/review">
          <label>Status <select name="status" defaultValue={text("status") ?? ""}><option value="">All</option><option value="staged">Staged</option><option value="deferred">Deferred</option><option value="rejected">Rejected</option><option value="approved">Approved</option></select></label>
          <label>Kind <select name="kind" defaultValue={text("kind") ?? ""}><option value="">All</option><option value="update">Update</option><option value="closure_review">Closure review</option><option value="new_resource">New resource</option></select></label>
          <label>Evidence quality <select name="evidenceQuality" defaultValue={text("evidenceQuality") ?? ""}><option value="">All</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label>
          <button type="submit">Filter</button>
        </form>
        {candidates.length ? (
          <ul className="candidate-list">
            {candidates.map((candidate) => {
              const fields = Object.keys(candidate.proposedValues);
              const preview = fields.slice(0, 2).map((field) => {
                const before = candidate.beforeValues?.[field];
                const after = candidate.proposedValues[field];
                return before ? `${fieldLabel(field)}: ${before} → ${after}` : `${fieldLabel(field)}: ${after}`;
              }).join(" · ");
              return <li key={candidate.id} className="candidate-row">
                <div className="candidate-main">
                  <a href={`/review/${candidate.id}`}>{candidate.resourceName ?? `Candidate ${candidate.id.slice(0, 8)}`}</a>
                  <span className={`status-chip status-${candidate.status}`}>{statusLabel(candidate.status)}</span>
                </div>
                <p className="candidate-meta">
                  {candidate.kind === "closure_review" && !fields.length
                    ? "Conflict with no proposed field change — open to review evidence."
                    : (preview || "No proposed fields")}
                </p>
              </li>;
            })}
          </ul>
        ) : (
          <p className="empty-queue">No staged candidates yet.{isOperator ? " Launch a small evidence check above when the baseline is ready." : " An operator must stage evidence before items appear here."}</p>
        )}
      </section>
    ) : (
      <section className="queue-panel">
        <p className="empty-queue">Operator access can launch pilots. Ask an admin for a reviewer grant to open the staged-candidate queue.</p>
      </section>
    )}
  </main>;
}
