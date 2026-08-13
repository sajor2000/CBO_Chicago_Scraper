# ChicagoHealthMap public CBO source profile

`chicagohealthmap-public-v1` is the only profile accepted by the baseline importer. It reads `public.cbo_public_directory_v1` using `source_id` and records the following public directory fields.

| Field | Source meaning |
| --- | --- |
| `organization_name` | General-resource organization name, when supplied. |
| `location_name` | WIC location name, when supplied. |
| `full_address`, `city`, `state`, `zip_code` | Public location address. |
| `location_type` | Existing resource type; WIC rows are labeled `wic`. |
| `website` | Existing public hyperlink or website. |
| `latitude`, `longitude` | Existing public map coordinates. |
| `description` | Existing public general-resource description. |
| `source_relation` | The originating mirror relation. |

The view uses stable namespaced IDs: `community_resource:<id>` and `wic:<wic_id>`. It deliberately does not add a phone number, operational status, internal notes, credentials, or non-directory contacts when the current source does not expose those as part of this public contract.

## Source-owner change procedure

1. Use the temporary read-only profiling credential to run `npm run profile:cbo-source` for `public.community_resource_locations` (`id`) and `public.wic_locations` (`wic_id`). Review counts, null IDs, duplicates, and columns.
2. Provision the separate `cbo_import_reader` role before applying the view SQL. Do not reuse the profiling credential for runtime import.
3. Review and apply [cbo_public_directory_v1.sql](../sql/source/cbo_public_directory_v1.sql) in the mirror. This creates only a view and grants its existing runtime role `SELECT`; it does not change source rows.
4. Profile `public.cbo_public_directory_v1` with `source_id`. It must have no null or duplicate source IDs.
5. Set only `SOURCE_DATABASE_URL` (for `cbo_import_reader`) and `CBO_SOURCE_PROFILE=chicagohealthmap-public-v1` for the import command. A new public field requires a new named profile, reviewed view revision, and a new baseline receipt; operators cannot extend the field list through environment variables.

The source-profile SQL was derived from the checked-in ChicagoHealthMap API entity mappings. The source owner must confirm the live profile before applying it. If either relation or public field differs, stop and create a new reviewed profile version rather than editing the import environment.
