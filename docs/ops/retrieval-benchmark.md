# Retrieval benchmark

Run the native HTTP and direct-Playwright comparison only against a checked-in local HTTP fixture manifest:

```sh
npm run benchmark:retrieval -- path/to/fixture-manifest.json
```

The command rejects non-local fixture origins and fails if database, provider, Azure, Clerk, or cron credentials are present. It writes a redacted JSON scorecard to stdout and does not create a run, candidate, review, source observation, or database record.

The container image is a one-shot local/CI smoke tool. It has no Railway schedule and must not call the application cron route. A Railway smoke remains an external gate: use it only after platform support for a non-root browser sandbox and a private fixture network has been verified.
