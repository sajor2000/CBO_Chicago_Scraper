# Reviewer guide

Only allowlisted Rush reviewers may open the queue or submit a decision. Review the source record, proposed fields, evidence links, score rationale, and any conflict or retrieval issue together.

This initial fixture surface is deliberately disabled unless `FIXTURE_MODE=true`. Configure Microsoft Entra before hosting it; an `x-reviewer-email` header is not an authentication mechanism.

Approve only the checked field subset and record a reason. Reject, defer, and reviewer edits also require a reason. A refreshed-evidence or reviewer-edit revision supersedes the prior revision and clears any approval; refresh before deciding when a revision conflict occurs. The queue cannot publish or edit the production directory.
