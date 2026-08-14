# Review workspace data dictionary

This workspace is a writable review database. It never writes to the ChicagoHealthMap source mirror or the production directory.

| Table | Purpose | Mutability |
| --- | --- | --- |
| `resources` | Stable identity for an imported reference resource, keyed by source and source ID. | Insert-only in v1. |
| `resource_snapshots` | Versioned source payload captured at import. | Append-only. |
| `baseline_import_receipts` | Aggregate outcome of a controlled read-only source-directory import. | Append-only; contains counts only. |
| `verification_runs` | Idempotent manual or scheduled batch request. | Run metadata; no source credentials. |
| `source_observations` | Provider observation, extracted values, and retrieval metadata. | Append-only; corrections link with `supersedes_observation_id`. |
| `candidate_revisions` | Proposed resource change with distinct before, proposed, and provenance values. | Append-only; corrections link with `supersedes_candidate_revision_id`. |
| `review_decisions` | Human decision for a candidate and approved field subset; terminal approvals/rejections may carry an optional reviewer CBO-eligibility label. | Append-only; superseding decision records correction. |
| `publish_intents` | Authorized payload handed to the isolated publisher. | Append-only. |
| `publication_receipts` | Publisher result, target reference, and rollback evidence. | Append-only. |
| `reviewer_access` | Reviewer allowlist and revocation state. | Revocable access record. |
| `categories` | Governed taxonomy including synonyms and lifecycle dates. | Governed migration data. |
| `resource_category_assignments` | Reviewer-approved many-to-many resource categories. | Assignment is linked to its approval decision. |
| `candidate_category_proposals` | Proposed category additions/removals awaiting review. | Belongs to an immutable candidate revision. |

Audit correction is additive: a bad observation, candidate, or decision is never edited or deleted. A new record links to the event it supersedes. Publication state is represented by a new receipt, not a changed intent.

`reviewer_cbo_eligibility` is nullable: `true` means eligible, `false` means not eligible, and `NULL` means not assessed. It is valid only for terminal approval or rejection decisions. It is an organization-level assessment independent of the proposed field decision; calibration excludes unlabeled, deferred, edited, historical, and insufficient-evidence records.
