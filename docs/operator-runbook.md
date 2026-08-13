# Operator runbook

Clerk controls access through a signed-in account whose subject has an active `operator` grant in the review workspace. Start a dry run through `POST /api/runs` with a unique idempotency key, bounded source selection, and budget. Repeating the same key returns the same run. Use `PATCH /api/runs` to cancel or resume; completion advances one durable checkpoint at a time. Cancelling releases an unfinished lease; a stale worker cannot complete it.

Cron is intentionally disabled (`vercel.json` has no schedules). After a manual non-production acceptance run, enable one `/api/cron` schedule and set `CRON_SECRET`; the endpoint rejects missing or invalid bearer secrets. The review app uses the dedicated Neon review workspace only; its startup connection must find `review_workspace.workspace_sentinel` with `workspace_kind = dedicated_review_workspace` before hosted use.
