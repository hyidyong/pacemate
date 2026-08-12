-- Stage 6 (multi-tenancy) M1: tenant metadata on the schools table.
-- schools IS the tenant entity (tenant_id = schools.id). Adds the minimal
-- fields tenant resolution needs: a status the resolver can deny, and a
-- stable slug reserved for Stage 7 host/IdP -> tenant mapping. schools.id
-- (immutable uuid) remains the authorization boundary; name/slug are never
-- used as a security boundary.
begin;

do $$
begin
  if to_regclass('public.schools') is null then
    raise exception 'public.schools is required';
  end if;
end
$$;

alter table public.schools
  add column if not exists status text not null default 'active',
  add column if not exists slug text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.schools'::regclass
      and conname = 'schools_status_check'
  ) then
    alter table public.schools
      add constraint schools_status_check
      check (status in ('active', 'suspended'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.schools'::regclass
      and conname = 'schools_slug_key'
  ) then
    alter table public.schools
      add constraint schools_slug_key unique (slug);
  end if;
end
$$;

-- Postcondition: every school row is a valid status.
do $$
begin
  if exists (select 1 from public.schools where status not in ('active', 'suspended')) then
    raise exception 'schools.status backfill invariant violated';
  end if;
end
$$;

commit;
