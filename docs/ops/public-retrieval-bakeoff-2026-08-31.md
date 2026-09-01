# Public retrieval bake-off — 2026-08-31

## Scope

For a compact visual review, open
[`public-retrieval-bakeoff-2026-08-31.html`](./public-retrieval-bakeoff-2026-08-31.html).

This one-time experiment queried a read-only Neon account for 100 distinct public
`community_resource_locations.hyperlink` values. It made no database writes and
stored no source rows, URLs, credentials, or page bodies in the receipt. The
tested arms made ordinary public HTTP/browser requests only: no proxy, stealth,
CAPTCHA bypass, session rotation, recursive crawl, or provider API.

Each response was judged against its own public directory row using
case-insensitive visible-text matching for organization name and address, plus a
punctuation-insensitive phone match. Results are aggregate counts, not a claim
that a live site remains correct.

## Results

| Runner | Reached | Name | Address | Phone | Median elapsed | Variable provider cost |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Native HTTP | 78 / 100 | 27 | 8 | 35 | 144 ms | $0 |
| Direct Playwright | 73 / 100 | 27 | 8 | 37 | 692 ms | $0 |
| Crawlee + Playwright | 87 / 100 | 41 | 21 | 35 | 1,197 ms | $0 |
| Scrapling `Fetcher` | 97 / 100 | 42 | 20 | 36 | 190 ms | $0 |

The final Crawlee values measure navigation time rather than queue wait. The
final Scrapling values use its full visible-text API rather than the root-node
text property. Those corrections were rerun on the same deterministic cohort.

## Decision

Scrapling `Fetcher` is the experimental winner: it had the highest reach and
name-match counts, near-native median latency, and no variable provider charge.
This is **not** production adoption. Discovery remains disabled, scheduled work
remains unchanged, and the existing source policy and reviewed plan still
exclude Scrapling's broader stealth/proxy surface.

Before any adoption, explicitly revise the source-policy decision, add a
policy-bound adapter that permits only plain `Fetcher`, and run a small
human-reviewed canary through the existing evidence and review workflow.
