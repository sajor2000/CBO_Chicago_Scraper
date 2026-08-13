import { authorizeReviewer, type AuthenticatedUser } from "../../lib/auth.ts";
import { reviewRepository } from "../../lib/repositories/review.ts";

export function renderReviewQueue(user: AuthenticatedUser) {
  authorizeReviewer(user);
  const candidates = reviewRepository.list();
  return candidates;
}

export default function ReviewQueuePage() {
  return <main><h1>Reviewer queue</h1><p>Sign in with an approved Rush account to review staged evidence.</p></main>;
}
