export interface AuthenticatedUser {
  email: string;
  name?: string;
}

export class ReviewerAuthorizationError extends Error {
  constructor(message = "Reviewer authorization required") {
    super(message);
    this.name = "ReviewerAuthorizationError";
  }
}

export class FixtureModeError extends Error {
  constructor() {
    super("Header-based identity is available only when FIXTURE_MODE=true; configure Microsoft Entra before deployment.");
    this.name = "FixtureModeError";
  }
}

const normalized = (email: string) => email.trim().toLowerCase();
const entries = (value: string | undefined) => new Set((value ?? "").split(",").map(normalized).filter(Boolean));

/** Authorization is separate from Entra authentication so the allowlist remains explicit. */
export function authorizeReviewer(user: AuthenticatedUser | undefined, allowlist = process.env.REVIEWER_ALLOWLIST): AuthenticatedUser {
  if (!user?.email || !entries(allowlist).has(normalized(user.email))) throw new ReviewerAuthorizationError();
  return { ...user, email: normalized(user.email) };
}

export function authorizeRunOperator(user: AuthenticatedUser | undefined, allowlist = process.env.RUN_OPERATOR_ALLOWLIST): AuthenticatedUser {
  if (!user?.email || !entries(allowlist).has(normalized(user.email))) throw new ReviewerAuthorizationError("Manual run authorization required");
  return { ...user, email: normalized(user.email) };
}

/** Temporary local fixture seam; a request header is never a production identity. */
export function fixtureUserFromHeader(request: Request): AuthenticatedUser {
  if (process.env.FIXTURE_MODE !== "true") throw new FixtureModeError();
  return { email: request.headers.get("x-reviewer-email") ?? "" };
}
