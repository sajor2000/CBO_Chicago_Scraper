# Retrieval benchmark

Run the native HTTP, direct-Playwright, and package-default Crawlee + Playwright comparison only against a checked-in local HTTP fixture manifest:

```sh
npm run benchmark:retrieval -- path/to/fixture-manifest.json
```

The command rejects non-local fixture origins and fails if database, provider, Azure, Clerk, or cron credentials are present. For a container smoke, `http://fixture` is the only non-loopback origin allowed and must resolve on an internal Docker network. It writes a redacted JSON scorecard to stdout and does not create a run, candidate, review, source observation, or database record.

Crawlee runs with its package defaults in this local comparison only, so its observed retries, session/storage behavior, and browser behavior are evidence rather than assumptions. Its default local `storage/` output is ignored by Git; use an ephemeral mounted directory for container runs. It is not a production retrieval adapter; a later adoption decision must apply the checked-in source-policy controls.

The container image is a one-shot local/CI smoke tool. It has no Railway schedule and must not call the application cron route. A Railway smoke remains an external gate: use it only after platform support for a non-root browser sandbox and a private fixture network has been verified.

A separately authorized, read-only public-directory experiment is recorded in
[`public-retrieval-bakeoff-2026-08-31.md`](./public-retrieval-bakeoff-2026-08-31.md).
It is decision evidence only; it does not relax this fixture-only command or
authorize a production retrieval adapter.
