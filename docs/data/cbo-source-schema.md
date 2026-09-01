# CBO source CSV contract

This is the September 1, 2026 checked-in contract for the read-only `public` source relations. The executable contract is `src/lib/imports/cbo-source-schema.ts`; `npm run verify:cbo-source-schema` compares this metadata with the authorized source database before a production release. It reads no source rows.

Every CSV uses the exact lowercase names and ordinal order below. `geom` is structurally required but always blank in a handoff CSV: snapshots retain longitude and latitude, and the receiving data team recreates database geometry if needed.

## `community_resource_locations`

| # | Column | PostgreSQL type | Nullable |
| --- | --- | --- | --- |
| 1 | `id` | `integer` | no |
| 2 | `organization_name` | `text` | yes |
| 3 | `location_type` | `text` | yes |
| 4 | `full_address` | `text` | yes |
| 5 | `hyperlink` | `text` | yes |
| 6 | `latitude` | `double precision` | yes |
| 7 | `longitude` | `double precision` | yes |
| 8 | `categories` | `jsonb` | yes |
| 9 | `status` | `text` | yes |
| 10 | `capacity` | `text` | yes |
| 11 | `phone` | `text` | yes |
| 12 | `email` | `text` | yes |
| 13 | `hours` | `jsonb` | yes |
| 14 | `languages` | `jsonb` | yes |
| 15 | `description` | `text` | yes |
| 16 | `confidence` | `double precision` | yes |
| 17 | `sources` | `jsonb` | yes |
| 18 | `last_verified` | `timestamp with time zone` | yes |
| 19 | `last_enriched` | `timestamp with time zone` | yes |
| 20 | `geom` | `geometry(Point,4326)` | yes |
| 21 | `created_at` | `timestamp with time zone` | yes |
| 22 | `updated_at` | `timestamp with time zone` | yes |

## `wic_locations`

| # | Column | PostgreSQL type | Nullable |
| --- | --- | --- | --- |
| 1 | `wic_id` | `integer` | no |
| 2 | `location_name` | `text` | no |
| 3 | `location_type` | `text` | yes |
| 4 | `full_address` | `text` | yes |
| 5 | `city` | `text` | yes |
| 6 | `state` | `character(2)` | yes |
| 7 | `zip_code` | `character varying(10)` | yes |
| 8 | `county` | `text` | yes |
| 9 | `fips_state` | `character(2)` | yes |
| 10 | `fips_county` | `character(5)` | yes |
| 11 | `phone` | `character varying(20)` | yes |
| 12 | `website` | `text` | yes |
| 13 | `longitude` | `double precision` | no |
| 14 | `latitude` | `double precision` | no |
| 15 | `geom` | `geometry(Point,4326)` | yes |
| 16 | `source_date` | `date` | yes |
| 17 | `created_at` | `timestamp with time zone` | yes |
| 18 | `updated_at` | `timestamp with time zone` | yes |

## Approved proposal aliases

Only these proposal names may change a copied source row. All other names must already be an exact source column for the selected relation.

| Relation | Proposal field | Source column |
| --- | --- | --- |
| `community_resource_locations` | `address` | `full_address` |
| `community_resource_locations` | `website` | `hyperlink` |
| `community_resource_locations` | `name` | `organization_name` |
| `wic_locations` | `address` | `full_address` |
| `wic_locations` | `name` | `location_name` |

`geom` is never an approved proposal field and must be blank. Required copied source keys are `id` for community resources and `wic_id`, `location_name`, `longitude`, and `latitude` for WIC.
