import { neon } from "@neondatabase/serverless";

/** Creates a query client for the writable review workspace only. */
export function reviewWorkspaceDb(databaseUrl = process.env.REVIEW_DATABASE_URL) {
  if (!databaseUrl) {
    throw new Error("REVIEW_DATABASE_URL is required for review-workspace access");
  }

  return neon(databaseUrl);
}
