# Discovery query matrix v1

Policy version: `chicago-seven-county-v1`.

The repository owns the discovery matrix in `src/lib/discovery/query-matrix.ts`. It combines the existing approved category codes with Cook, DuPage, Kane, Kendall, Lake, McHenry, and Will counties. Each resolved term is executed separately through Google Places and the single configured Tavily-or-Exa fallback, with at most five results per provider call and ten cells per manual launch.

Operators cannot author or schedule queries. Every launch freezes the resolved category, county, provider, text, policy version, and result cap. Changing terms requires code review, a new policy version, service-owner approval, and a new activation event referencing a completed accepted known-directory cycle.

Location bias and query wording are not scope evidence. A candidate requires a structured in-scope county and exact public service address. Search output is a lead only; official/trusted corroboration and deterministic identity/eligibility gates remain mandatory.
