import { UserButton } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { hasWorkspaceRole, requireWorkspaceRole, WorkspaceAuthorizationError, WorkspaceTargetError } from "../../lib/db.ts";
import { reviewRepository } from "../../lib/repositories/review.ts";
import { RunControls } from "./run-controls.tsx";

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

export default async function ReviewQueuePage() {
  const { userId } = await auth();
  if (!userId) {
    return <AuthGate title="Sign in required" body="Open the review workspace with a ChicagoHealthMap Clerk account." href="/sign-in" linkLabel="Go to sign in" />;
  }

  try {
    await requireWorkspaceRole(userId, "reviewer");
  } catch (error) {
    if (error instanceof WorkspaceAuthorizationError) {
      return <AuthGate title="Access denied" body="Your account is signed in but is not granted reviewer access in the dedicated review workspace." href="/sign-in" linkLabel="Switch account" />;
    }
    if (error instanceof WorkspaceTargetError) {
      return <AuthGate title="Workspace unavailable" body="REVIEW_DATABASE_URL must point at the dedicated review workspace before the queue can load." href="/review" linkLabel="Retry" />;
    }
    throw error;
  }

  const isOperator = await hasWorkspaceRole(userId, "operator");
  const candidates = await reviewRepository.list();
  let resources: Array<{ id: string; name: string }> = [];
  let baselineError: string | undefined;
  if (isOperator) {
    try {
      await reviewRepository.assertBaselineReady();
      resources = await reviewRepository.listSeededResources(100);
    } catch (error) {
      baselineError = error instanceof Error ? error.message : "Baseline is not ready for a pilot.";
    }
  }

  return <main className="work-surface">
    <AppHeader />
    <section className="page-intro">
      <h1>Reviewer queue</h1>
      <p>Review staged evidence and approve only the supported field changes. Nothing here publishes to ChicagoHealthMap production.</p>
    </section>

    {isOperator && (
      baselineError
        ? <section className="pilot-panel" aria-labelledby="pilot-title">
          <h2 id="pilot-title">Run a small evidence check</h2>
          <p className="pilot-empty">{baselineError} Complete a reconciled baseline import before launching a pilot.</p>
        </section>
        : <RunControls resources={resources} />
    )}

    <section className="queue-panel" aria-labelledby="queue-title">
      <h2 id="queue-title">Staged candidates</h2>
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
  </main>;
}
