import { Fragment } from "react";
import { UserButton } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { requireWorkspaceRole, WorkspaceAuthorizationError, WorkspaceTargetError } from "../../../lib/db.ts";
import { reviewRepository } from "../../../lib/repositories/review.ts";
import { ReviewActions } from "../review-actions.tsx";

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

function AuthGate({ title, body }: { title: string; body: string }) {
  return <main className="work-surface">
    <AppHeader />
    <section className="state-panel">
      <h1>{title}</h1>
      <p>{body}</p>
      <p><a href="/sign-in">Go to sign in</a></p>
    </section>
  </main>;
}

export default async function CandidateReviewPage({ params }: { params: Promise<{ candidateId: string }> }) {
  const { userId } = await auth();
  if (!userId) return <AuthGate title="Sign in required" body="Open this candidate with a ChicagoHealthMap Clerk account." />;
  try {
    await requireWorkspaceRole(userId, "reviewer");
  } catch (error) {
    if (error instanceof WorkspaceAuthorizationError || error instanceof WorkspaceTargetError) {
      return <AuthGate title="Access denied" body="Your account cannot open review candidates in this workspace." />;
    }
    throw error;
  }

  const candidate = await reviewRepository.get((await params).candidateId);
  if (!candidate) {
    return <main className="work-surface">
      <AppHeader />
      <section className="state-panel">
        <h1>Candidate not found</h1>
        <p>This revision may have been removed or the link is incorrect.</p>
        <p><a href="/review">Back to queue</a></p>
      </section>
    </main>;
  }

  const fields = Object.keys(candidate.proposedValues);
  return <main className="work-surface">
    <AppHeader />
    <p className="crumb"><a href="/review">← Reviewer queue</a></p>
    <section className="page-intro">
      <h1>{candidate.resourceName ?? `Candidate ${candidate.id.slice(0, 8)}`}</h1>
      <p>Status: {statusLabel(candidate.status)} · revision {candidate.revision}{candidate.kind ? ` · ${statusLabel(candidate.kind)}` : ""}</p>
    </section>

    <section className="detail-panel" aria-labelledby="fields-title">
      <h2 id="fields-title">Proposed field changes</h2>
      {fields.length ? (
        <dl className="field-diff">
          {fields.map((field) => (
            <Fragment key={field}>
              <dt>{fieldLabel(field)}</dt>
              <dd>
                <span className="before">Current: {candidate.beforeValues?.[field] || "Not recorded"}</span>
                <span className="after">Proposed: {candidate.proposedValues[field]}</span>
              </dd>
            </Fragment>
          ))}
        </dl>
      ) : (
        <p className="conflict-note">
          {candidate.kind === "closure_review"
            ? "This is a closure conflict with no proposed directory field. Review the evidence, then defer or reject. The app never auto-closes a resource."
            : "No field values were proposed for this candidate."}
        </p>
      )}
    </section>

    <section className="detail-panel" aria-labelledby="evidence-title">
      <h2 id="evidence-title">Evidence</h2>
      {candidate.evidence.length ? (
        <ul className="evidence-list">
          {candidate.evidence.map((item) => <li key={item}>{item.startsWith("http") ? <a href={item} target="_blank" rel="noreferrer">{item}</a> : item}</li>)}
        </ul>
      ) : (
        <p>No evidence URLs were attached to this revision.</p>
      )}
    </section>

    <ReviewActions candidateId={candidate.id} expectedRevision={candidate.revision} proposedValues={candidate.proposedValues} />
  </main>;
}
