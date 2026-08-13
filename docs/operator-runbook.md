# Operator runbook

Clerk controls operator access through a signed-in account. Start a dry run through `POST /api/runs` with a unique idempotency key, bounded source selection, and budget. Repeating the same key returns the same run. Use `PATCH /api/runs` to cancel or resume; completion advances one durable checkpoint at a time.

Cron is intentionally disabled (`vercel.json` has no schedules). After a manual non-production acceptance run, enable one `/api/cron` schedule and set `CRON_SECRET`; the endpoint rejects missing or invalid bearer secrets. This implementation is an in-memory test adapter only: deploy durable Neon-backed run, lock, checkpoint, report, and audit repositories before any hosted trigger.
