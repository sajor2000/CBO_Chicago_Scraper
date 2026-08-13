# ChicagoHealthMap CBO Verifier

## Product

Internal review-first tool for keeping ChicagoHealthMap community-based organization (CBO) and WIC directory records current. Operators start bounded public-evidence checks; reviewers approve only supported field-level changes. Nothing publishes to production from this app.

## Users

Small ChicagoHealthMap operator and reviewer team. Signed in with Clerk. Operators launch pilots; reviewers decide field diffs. Both need calm, scannable task UI—not an engineering console and not marketing.

## Mode

**Operate.** Success is completing a verification or decision task quickly with clear evidence and safe defaults.

## Brand voice

Calm, clinical, civic. Short instructional copy. No hype, no emoji, no “boost productivity” language. Name the action and the recovery when something fails.

## Anti-references

- Purple / indigo gradient themes
- Inter / Roboto / Arial / default system stacks as the designed voice
- Nested cards, pill clusters, stat strips, floating badges
- Dark-mode-first chrome
- Autonomous “AI closed this resource” framing—humans decide; AI is advisory only

## Constraints

- Review-first: provider failure, missing URL, or Google-only closure never auto-closes or deletes a CBO
- Dedicated Neon review workspace only; original mirror and Azure production stay read-only
- Cron stays disabled until a manual pilot is accepted
- Browser never receives provider credentials or raw SQL
