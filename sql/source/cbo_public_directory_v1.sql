-- Apply in the ChicagoHealthMap mirror / dedicated verifier Neon project after
-- the source owner has profiled the relations and reviewed the public-directory contract.
-- This does not alter source records or ChicagoHealthMap production data.
--
-- Note: public.community_resource_locations in the verifier copy does not carry
-- city/state/zip columns; those fields are null for community resources and
-- populated for WIC rows.

create or replace view public.cbo_public_directory_v1 as
select
  'community_resource:' || resource.id::text as source_id,
  resource.organization_name,
  null::text as location_name,
  resource.full_address,
  null::text as city,
  null::text as state,
  null::text as zip_code,
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

-- Optional: provision a dedicated read role for imports. Safe to skip when the
-- importer uses the workspace owner during controlled setup.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'cbo_import_reader') then
    grant select on public.cbo_public_directory_v1 to cbo_import_reader;
  end if;
end $$;
