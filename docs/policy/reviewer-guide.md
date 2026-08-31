# Reviewer guide

Clerk protects the reviewer queue and its API routes. Invite the small ChicagoHealthMap team to the Clerk application. Each decision records the signed-in Clerk user ID; no Rush or Vercel-team credential is required.

Approve only the checked field subset and record a reason. Reject, defer, and reviewer edits also require a reason. A refreshed-evidence or reviewer-edit revision supersedes the prior revision and clears any approval; refresh before deciding when a revision conflict occurs. The queue cannot publish or edit the production directory.

When the review concerns whether the organization is a CBO, an approval or rejection can also carry an optional organization-level assessment: eligible, not eligible, or not assessed. This label does not approve or reject any individual field, and it cannot be submitted with a defer or edit. Only explicit terminal labels contribute to calibration; an omitted label is the normal choice for a routine field correction.

## Reviewing a discovered location

A discovered candidate represents one physical service location. Confirm the proposed public name, exact service address, county, category, public phone/site, direct-service evidence, CBO eligibility evidence, source lineage, and deterministic duplicate screen. Search rank, snippets, Google status, and AI output are never sufficient proof.

- `duplicate`: same Place ID without address conflict, or the same normalized full address plus a matching name/domain/phone. It stays out of the candidate queue.
- `possible_duplicate`: identity signals conflict or indicate the same organization without proving the same physical location. Do not auto-merge; inspect the location-level evidence.
- `out_of_scope`: structured address evidence places the service outside Cook, DuPage, Kane, Kendall, Lake, McHenry, or Will County.
- `not_a_cbo`: captured evidence fails the existing CBO eligibility policy.
- `insufficient_evidence`: exact address, direct service, eligibility, or independent corroboration is missing. Service-area-only resources remain here in v1.

`advisory_unavailable` means deterministic gates passed but the AI assessment failed; review may continue. Approval is immutable and appears as **Awaiting map handoff**. There is no publish/export action for a new resource. Reject, defer, or edit when the proposed fields or evidence do not support addition; never infer missing facts from query wording.
