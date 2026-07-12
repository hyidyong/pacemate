-- PaceMate curriculum draft admission-year constraint refinement (1-D-5B-0)
-- Additive schema refinement only. No data backfill, DML, RLS, policy, grant,
-- function, view, student assignment, or seed data is included.

begin;

-- Fail closed if existing rows would violate the post-migration state rules.
do $$
declare
  invalid_count integer;
begin
  select count(*)
    into invalid_count
  from public.curriculum_versions
  where (status = 'active' and admission_year_from is null)
     or (admission_year_to is not null
         and (admission_year_from is null or admission_year_to < admission_year_from));

  if invalid_count <> 0 then
    raise exception 'curriculum_versions contains % rows incompatible with admission-year state rules', invalid_count;
  end if;
end
$$;

alter table public.curriculum_versions
  alter column admission_year_from drop not null;

alter table public.curriculum_versions
  drop constraint if exists curriculum_versions_year_order;

alter table public.curriculum_versions
  add constraint curriculum_versions_admission_year_state_check
  check (
    (status <> 'active' or admission_year_from is not null)
    and (
      admission_year_from is null
      or admission_year_from between 1900 and 2200
    )
    and (
      admission_year_to is null
      or (
        admission_year_from is not null
        and admission_year_to between admission_year_from and 2200
      )
    )
  );

-- The existing identity index permits multiple NULL admission_year_from values
-- under PostgreSQL NULL semantics. This partial index prevents duplicate
-- open-ended draft placeholders without changing active-range behavior.
create unique index if not exists curriculum_versions_draft_null_range_idx
  on public.curriculum_versions (school_id, department_id, version_key)
  where status = 'draft'
    and admission_year_from is null
    and admission_year_to is null;

commit;
