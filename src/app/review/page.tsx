import { UserButton } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { requireWorkspaceRole, WorkspaceAuthorizationError, WorkspaceTargetError } from "../../lib/db.ts";

export default async function ReviewQueuePage() {
  const { userId } = await auth();
  if (!userId) return <main><h1>Authentication required</h1></main>;
  try {
    await requireWorkspaceRole(userId, "reviewer");
  } catch (error) {
    if (error instanceof WorkspaceAuthorizationError || error instanceof WorkspaceTargetError) return <main><h1>Access denied</h1></main>;
    throw error;
  }
  return <main><UserButton /><h1>Reviewer queue</h1><p>Review staged evidence and approve only the supported field changes.</p></main>;
}
