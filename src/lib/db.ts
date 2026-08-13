import { neon } from "@neondatabase/serverless";

export class WorkspaceAuthorizationError extends Error {
  constructor() {
    super("You do not have access to the review workspace.");
    this.name = "WorkspaceAuthorizationError";
  }
}

export class WorkspaceTargetError extends Error {
  constructor() {
    super("REVIEW_DATABASE_URL does not point to the dedicated review workspace.");
    this.name = "WorkspaceTargetError";
  }
}

/** Creates a query client for the writable review workspace only. */
export function reviewWorkspaceDb(databaseUrl = process.env.REVIEW_DATABASE_URL) {
  if (!databaseUrl) {
    throw new Error("REVIEW_DATABASE_URL is required for review-workspace access");
  }

  return neon(databaseUrl);
}

export async function assertReviewWorkspace(query = reviewWorkspaceDb()) {
  const rows = await query`
    select exists (
      select 1 from review_workspace.workspace_sentinel
      where singleton and workspace_kind = 'dedicated_review_workspace'
    ) as is_review_workspace
  ` as Array<{ is_review_workspace: boolean }>;
  if (!rows[0]?.is_review_workspace) throw new WorkspaceTargetError();
}

export async function requireWorkspaceRole(subject: string, role: "reviewer" | "operator") {
  const query = reviewWorkspaceDb();
  await assertReviewWorkspace(query);
  const rows = await query`
    select exists (
      select 1 from review_workspace.reviewer_access
      where subject = ${subject} and role = ${role} and revoked_at is null
    ) as is_allowed
  ` as Array<{ is_allowed: boolean }>;
  if (!rows[0].is_allowed) throw new WorkspaceAuthorizationError();
}
