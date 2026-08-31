# Railway manual dispatcher

Railway is an optional, short-lived dispatcher for the already deployed review application. It does not hold provider credentials, connect to Neon directly, scrape sites, or bypass the review workflow. It sends one authenticated request to the existing production `GET /api/cron` route; that route retains the durable lease, known-work-first dispatch, provider budgets, and discovery-activation checks.

## Create the service

1. In Railway, create a project and add a GitHub service from this repository and the reviewed branch.
2. In the service build settings, set the Dockerfile path to `Dockerfile.railway-dispatcher`.
3. Add only these service variables as Railway secrets:
   - `CBO_CRON_URL`: the exact production review-app URL ending in `/api/cron`.
   - `CRON_SECRET`: the existing production cron secret.
4. Do not add a database, volume, public domain, provider credential, Azure credential, or source-database credential.
5. Leave **Cron Schedule** empty. This service is manual-only until the documented canary and a separate scheduling authorization are complete.

Railway builds a tiny Node image and the process exits after one request. A non-2xx response fails the execution without printing the secret or response body.

## Manual canary

Before invoking Railway, confirm the production review app is ready, a service owner has authorized the bounded run, and an operator has completed the applicable Stage A setup in the [operator runbook](operator-runbook.md). Use Railway's **Run Now** control once, then inspect the application run report and reviewer queue. Railway logs only report the HTTP status, optional run ID, and whether the application skipped the request.

Do not add a Railway cron expression, enable broad discovery, or treat a successful request as canary acceptance. Stop and investigate on any dispatcher failure, provider failure, policy violation, unexpected candidate volume, or runbook stop condition.
