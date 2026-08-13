import { Fragment } from "react";
import { auth } from "@clerk/nextjs/server";
import { requireWorkspaceRole, WorkspaceAuthorizationError, WorkspaceTargetError } from "../../../lib/db.ts";
import { reviewRepository } from "../../../lib/repositories/review.ts";
import { ReviewActions } from "../review-actions.tsx";

export default async function CandidateReviewPage({ params }: { params: Promise<{ candidateId: string }> }) {
  const { userId } = await auth();
  if (!userId) return <main><h1>Authentication required</h1></main>;
  try {
    await requireWorkspaceRole(userId, "reviewer");
  } catch (error) {
    if (error instanceof WorkspaceAuthorizationError || error instanceof WorkspaceTargetError) return <main><h1>Access denied</h1></main>;
    throw error;
  }
  const candidate = await reviewRepository.get((await params).candidateId);
  if (!candidate) return <main><h1>Candidate not found</h1></main>;
  return <main><h1>Candidate {candidate.id}</h1><p>Status: {candidate.status} · revision {candidate.revision}</p><h2>Proposed field changes</h2><dl>{Object.entries(candidate.proposedValues).map(([field, value]) => <Fragment key={field}><dt>{field}</dt><dd>{value}</dd></Fragment>)}</dl><h2>Evidence</h2><ul>{candidate.evidence.map((item) => <li key={item}>{item}</li>)}</ul><ReviewActions candidateId={candidate.id} expectedRevision={candidate.revision} proposedValues={candidate.proposedValues} /></main>;
}
