# Source policy

All provider results are captured as inputs to this code; these adapters make no HTTP requests and hold no credentials.

- Firecrawl is primary public official-site evidence. Browser interaction is separately bounded and allowlisted.
- Google Places corroborates address, phone, and operating status. A Google-only closure is always a conflict, never a closed-status update.
- Trusted local directories may create an unmatched potential-new-resource lead. IRS corroborates nonprofit identity.
- Exactly one configured search fallback may discover an official site; it cannot verify closure.
- `blocked`, `timeout`, and `rate_limited` are `unable_to_verify`, with no status delta. GPT-5.6 receives only captured evidence, treats it as untrusted data, and returns a bounded advisory on CBO eligibility, operating status, evidence quality, citations, and rationale. Its citations must name captured providers. It cannot collect evidence, invoke tools, publish, merge identities, or close records.
