-- Apply in the read-only ChicagoHealthMap mirror only after the source owner
-- has profiled the relations and reviewed the public-directory contract.
-- This does not alter source records or ChicagoHealthMap production data.

create view public.cbo_public_directory_v1 as
select
  'community_resource:' || resource.id::text as source_id,
  resource.organization_name,
  null::text as location_name,
  resource.full_address,
  resource.city,
  resource.state,
  resource.zip_code,
  resource.location_type,
  resource.hyperlink as website,
  resource.latitude,
  resource.longitude,
  resource.description,
  'community_resource_locations'::text as source_relation
from public.community_resource_locations as resource
union all
select
  'wic:' || wic.wic_id::text as source_id,
  null::text as organization_name,
  wic.location_name,
  wic.full_address,
  wic.city,
  wic.state,
  wic.zip_code,
  'wic'::text as location_type,
  wic.website,
  wic.latitude,
  wic.longitude,
  null::text as description,
  'wic_locations'::text as source_relation
from public.wic_locations as wic;

-- `cbo_import_reader` is a new source role, distinct from the temporary
-- profiling credential. Provision it with CONNECT, schema USAGE, and this
-- SELECT grant only; do not grant base-table access.
grant select on public.cbo_public_directory_v1 to cbo_import_reader;
