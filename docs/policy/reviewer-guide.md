# Reviewer guide

Clerk protects the reviewer queue and its API routes. Invite the small ChicagoHealthMap team to the Clerk application. Each decision records the signed-in Clerk user ID; no Rush or Vercel-team credential is required.

Approve only the checked field subset and record a reason. Reject, defer, and reviewer edits also require a reason. A refreshed-evidence or reviewer-edit revision supersedes the prior revision and clears any approval; refresh before deciding when a revision conflict occurs. The queue cannot publish or edit the production directory.

For a `new_resource`, review the exact public service address and county, the direct-service and CBO-eligibility rationale, source lineage, and duplicate screen. AI advice is labeled separately and is never proof. An approval remains **Awaiting map handoff**; it does not create an Azure insert, export, or publish control.

When the review concerns whether the organization is a CBO, an approval or rejection can also carry an optional organization-level assessment: eligible, not eligible, or not assessed. This label does not approve or reject any individual field, and it cannot be submitted with a defer or edit. Only explicit terminal labels contribute to calibration; an omitted label is the normal choice for a routine field correction.
