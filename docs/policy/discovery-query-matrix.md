# Discovery query matrix

`src/lib/discovery/query-matrix.ts` is the reviewed, versioned source of the v1 matrix. It combines the approved category taxonomy with the seven-county service area, and caps a manual launch at five cells, 50 unique leads, and 100 provider calls.

Operators cannot author queries in the UI. A service owner approves the policy version and selected cells before activation. Discovery is review-only: it never writes the copied CBO/WIC sources or Azure.
