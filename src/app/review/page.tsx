import { UserButton } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { requireWorkspaceRole, WorkspaceAuthorizationError, WorkspaceTargetError } from "../../lib/db.ts";
import { reviewRepository } from "../../lib/repositories/review.ts";

export default async function ReviewQueuePage() {
  const { userId } = await auth();
  if (!userId) return <main><h1>Authentication required</h1></main>;
  try {
    await requireWorkspaceRole(userId, "reviewer");
  } catch (error) {
    if (error instanceof WorkspaceAuthorizationError || error instanceof WorkspaceTargetError) return <main><h1>Access denied</h1></main>;
    throw error;
  }
  const candidates = await reviewRepository.list();
  return <main><UserButton /><h1>Reviewer queue</h1><p>Review staged evidence and approve only the supported field changes.</p>{candidates.length ? <ul className="candidate-list">{candidates.map((candidate) => <li key={candidate.id}><a href={`/review/${candidate.id}`}>{candidate.id}</a><span>{candidate.status}</span><span>{Object.keys(candidate.proposedValues).join(", ") || "No proposed fields"}</span></li>)}</ul> : <p>No staged candidates yet.</p>}</main>;
}
