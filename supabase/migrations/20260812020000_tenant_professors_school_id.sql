-- Stage 6 (multi-tenancy) M2: professors.school_id (the counseling domain's
-- tenant anchor). The professors -> departments -> schools chain is broken by
-- a nullable professors.department_id, so tenancy is DENORMALIZED onto
-- professors rather than derived through the join. Backfilled from the
-- department join (all live professors resolve cleanly), then NOT NULL.
begin;

do $$
begin
  if to_regclass('public.professors') is null then
    raise exception 'public.professors is required';
  end if;
  -- The default-tenant backfill fallback below is only correct while exactly
  -- one tenant exists (Stage 6 precondition).
  if (select count(*) from public.schools) <> 1 then
    raise exception 'M2 assumes a single existing tenant; found % schools',
      (select count(*) from public.schools);
  end if;
end
$$;

alter table public.professors
  add column if not exists school_id uuid references public.schools(id);

-- Backfill from the department chain first (authoritative provenance).
update public.professors p
   set school_id = d.school_id
  from public.departments d
 where d.id = p.department_id
   and p.school_id is null;

-- Any professor with no department (none live; defensive) inherits the single
-- existing tenant.
update public.professors
   set school_id = (select id from public.schools limit 1)
 where school_id is null;

create index if not exists professors_school_id_idx
  on public.professors (school_id);

-- Validation: no professor may be tenant-less before we add NOT NULL.
do $$
begin
  if exists (select 1 from public.professors where school_id is null) then
    raise exception 'professors.school_id backfill incomplete';
  end if;
end
$$;

alter table public.professors
  alter column school_id set not null;

commit;
