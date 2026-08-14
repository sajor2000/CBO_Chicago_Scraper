# ChicagoHealthMap public CBO source profile

`chicagohealthmap-direct-v2` is the production import profile. It reads the existing `public.community_resource_locations` and `public.wic_locations` base tables without requiring source-side DDL. The legacy `chicagohealthmap-public-v1` view profile remains accepted for reproducibility but is not required by the current mirror.

| Field | Source meaning |
| --- | --- |
| `organization_name` | General-resource organization name, when supplied. |
| `location_name` | WIC location name, when supplied. |
| `full_address`, `city`, `state`, `zip_code` | Public location address. |
| `location_type` | Existing resource type; WIC rows are labeled `wic`. |
| `website`, `phone` | Existing public hyperlink/website and public phone. |
| `latitude`, `longitude` | Existing public map coordinates. |
| `description` | Existing public general-resource description. |
| `source_relation` | The originating mirror relation. |
| `source_record` | The complete public source row except `geom`; coordinates preserve the generated Point input. |

The profile uses stable namespaced IDs: `community_resource:<id>` and `wic:<wic_id>`. It uses a fixed code-owned projection, validates both base tables and their required columns before reading rows, and never accepts operator-supplied relation or field names. The source role must have read-only access to only these two relations. `geom` is excluded from JSON because it is generated from the preserved longitude and latitude values.

## Source-owner change procedure

1. Use the temporary read-only profiling credential to run `npm run profile:cbo-source` for `public.community_resource_locations` (`id`) and `public.wic_locations` (`wic_id`). Review counts, null IDs, duplicates, and columns.
2. Provision the separate `cbo_import_reader` role with `CONNECT`, `USAGE` on `public`, and `SELECT` on only the two approved tables. Do not reuse the profiling credential for runtime import.
3. Set only `SOURCE_DATABASE_URL` (for `cbo_import_reader`) and `CBO_SOURCE_PROFILE=chicagohealthmap-direct-v2` for the import command. No source view or other source-side DDL is required.
4. Run the import and require its count-only receipt to reconcile both relations with zero failed or skipped rows before verification.
5. A new public field or relation requires a new named code-reviewed profile and baseline receipt; operators cannot extend the allowlist through environment variables.

The source-profile SQL was derived from the checked-in ChicagoHealthMap API entity mappings. The source owner must confirm the live profile before applying it. If either relation or public field differs, stop and create a new reviewed profile version rather than editing the import environment.
