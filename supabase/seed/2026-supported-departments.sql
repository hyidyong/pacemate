-- PaceMate supported department reference seed (review-only until separately approved)
-- Scope: 계명대학교 / 전자공학과 only.
-- This file does not create or modify schools, curriculum, courses, students,
-- professors, offerings, reports, demo data, or graduation calculations.

begin;

do $$
declare
  v_school_id uuid;
  v_school_count integer;
  v_department_count integer;
  v_after_department_count integer;
begin
  select count(*)
    into v_school_count
  from public.schools
  where name = '계명대학교';

  if v_school_count <> 1 then
    raise exception 'Expected exactly one 계명대학교 school row, found %', v_school_count;
  end if;

  select id
    into v_school_id
  from public.schools
  where name = '계명대학교';

  select count(*)
    into v_department_count
  from public.departments
  where school_id = v_school_id
    and name = '전자공학과';

  if v_department_count > 1 then
    raise exception 'Duplicate 전자공학과 departments found for 계명대학교: %', v_department_count;
  elsif v_department_count = 0 then
    -- The existing unique (school_id, name) constraint makes this idempotent.
    insert into public.departments (school_id, name)
    values (v_school_id, '전자공학과')
    on conflict (school_id, name) do nothing;
  end if;

  -- Fail closed if a concurrent or unexpected state leaves anything other
  -- than exactly one target department after the conditional insert.
  select count(*)
    into v_after_department_count
  from public.departments
  where school_id = v_school_id
    and name = '전자공학과';

  if v_after_department_count <> 1 then
    raise exception 'Expected exactly one 전자공학과 department after seed, found %', v_after_department_count;
  end if;
end
$$;

-- Read-only postcondition checks; any mismatch aborts the transaction.
do $$
declare
  v_school_count integer;
  v_department_count integer;
begin
  select count(*)
    into v_school_count
  from public.schools
  where name = '계명대학교';

  select count(*)
    into v_department_count
  from public.departments d
  join public.schools s on s.id = d.school_id
  where s.name = '계명대학교'
    and d.name = '전자공학과';

  if v_school_count <> 1 or v_department_count <> 1 then
    raise exception 'Department seed postcondition failed: schools %, departments %',
      v_school_count, v_department_count;
  end if;
end
$$;

commit;
