import { authorizeReviewer, type AuthenticatedUser } from "../../lib/auth.ts";
import { reviewRepository } from "../../lib/repositories/review.ts";

export function renderReviewQueue(user: AuthenticatedUser) {
  authorizeReviewer(user);
  const candidates = reviewRepository.list();
  return `<main><h1>Review queue</h1><p>Evidence, conflicts, and proposed field values require an approved reviewer.</p><ul>${candidates.map((candidate) => `<li>${candidate.id}: ${candidate.status}</li>`).join("")}</ul></main>`;
}

export default function ReviewQueuePage() {
  return "<main><h1>Reviewer authorization required</h1><p>Sign in with an approved Rush account.</p></main>";
}
