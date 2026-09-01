import { UserButton } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { requireWorkspaceRole, WorkspaceAuthorizationError, WorkspaceTargetError } from "../../../lib/db.ts";

export default async function ExportsPage() {
  const { userId } = await auth();
  try {
    if (!userId) throw new WorkspaceAuthorizationError();
    await requireWorkspaceRole(userId, "operator");
  } catch (error) {
    if (error instanceof WorkspaceAuthorizationError || error instanceof WorkspaceTargetError) return <main className="work-surface"><section className="state-panel"><h1>Access denied</h1><p>Only a current operator can download an approved data-team handoff.</p><p><a href="/review">Back to workspace</a></p></section></main>;
    throw error;
  }
  return <main className="work-surface">
    <header className="app-header"><div><p className="brand">ChicagoHealthMap</p><p className="brand-sub">CBO verification</p></div><UserButton /></header>
    <p className="crumb"><a href="/review">← Review workspace</a></p>
    <section className="page-intro"><p className="eyebrow">Manual data-team handoff</p><h1>Approved existing-directory changes</h1><p>Each download has the exact current Neon source-table columns and complete copied rows, with only reviewer-approved fields applied. It does not write to Azure or ChicagoHealthMap; new-resource proposals remain out of the files until their separate insert contract is approved.</p><p><a className="primary-button" href="/api/exports/data-team?relation=community_resource_locations">Download CBO CSV</a> <a className="primary-button" href="/api/exports/data-team?relation=wic_locations">Download WIC CSV</a></p></section>
  </main>;
}
