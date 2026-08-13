import { reviewRepository } from "../../../lib/repositories/review.ts";

export default function CandidateReviewPage({ params }: { params: { candidateId: string } }) {
  const candidate = reviewRepository.get(params.candidateId);
  if (!candidate) return <main><h1>Candidate not found</h1></main>;
  return <main><h1>Candidate {candidate.id}</h1><p>Status: {candidate.status}</p><pre>{JSON.stringify(candidate.proposedValues, null, 2)}</pre><h2>Evidence</h2><ul>{candidate.evidence.map((item) => <li key={item}>{item}</li>)}</ul></main>;
}
