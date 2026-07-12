-- PaceMate demo reference seed: link the existing professor demo profile to
-- the single 2026-2 company-law offering.
--
-- This file is intentionally separate from migrations and is not executed by
-- the application. Review and run only as an explicitly approved seed step.

begin;

do $$
declare
  v_profile_id uuid;
  v_company_course_id uuid;
  v_company_offering_id uuid;
  v_company_professor_id uuid;
  v_company_professor_profile_id uuid;
  v_admin_offering_id uuid;
  v_admin_professor_id uuid;
  v_admin_professor_profile_id uuid;
  v_count integer;
  v_updated integer;
begin
  select count(*), min(id)
    into v_count, v_profile_id
    from public.profiles
   where identifier = 'prof1@pacemate.edu';

  if v_count <> 1 then
    raise exception 'Expected exactly one professor demo profile for prof1@pacemate.edu; found %', v_count;
  end if;

  if not exists (
    select 1
      from public.profiles
     where id = v_profile_id
       and role = 'professor'
  ) then
    raise exception 'Demo profile prof1@pacemate.edu must have role professor';
  end if;

  select count(*), min(id)
    into v_count, v_company_course_id
    from public.courses
   where name = '회사법';

  if v_count <> 1 then
    raise exception 'Expected exactly one course named 회사법; found %', v_count;
  end if;

  select count(*), min(co.id), min(co.professor_id)
    into v_count, v_company_offering_id, v_company_professor_id
    from public.course_offerings co
    join public.academic_terms t on t.id = co.term_id
   where co.course_id = v_company_course_id
     and t.semester_label = '2026-2';

  if v_count <> 1 then
    raise exception 'Expected exactly one 2026-2 company-law offering; found %', v_count;
  end if;

  select count(*)
    into v_count
    from public.professors
   where id = v_company_professor_id;

  if v_count <> 1 then
    raise exception 'Expected exactly one professor row for the company-law offering; found %', v_count;
  end if;

  select count(*), min(co.id), min(co.professor_id)
    into v_count, v_admin_offering_id, v_admin_professor_id
    from public.course_offerings co
    join public.courses c on c.id = co.course_id
    join public.academic_terms t on t.id = co.term_id
   where c.name = '행정절차와행정구제'
     and t.semester_label = '2026-2';

  if v_count <> 1 then
    raise exception 'Expected exactly one 2026-2 administrative-procedure offering; found %', v_count;
  end if;

  if v_company_offering_id = v_admin_offering_id
     or v_company_professor_id = v_admin_professor_id then
    raise exception 'Target and non-target offerings must have distinct offering and professor rows';
  end if;

  select profile_id
    into v_admin_professor_profile_id
    from public.professors
   where id = v_admin_professor_id;

  if exists (
    select 1
      from public.professors
     where profile_id = v_profile_id
       and id <> v_company_professor_id
  ) then
    raise exception 'Demo profile is already linked to a different professor row';
  end if;

  select profile_id
    into v_company_professor_profile_id
    from public.professors
   where id = v_company_professor_id;

  if v_company_professor_profile_id is not null and v_company_professor_profile_id <> v_profile_id then
    raise exception 'Company-law professor row is already linked to another profile';
  end if;

  update public.professors
     set profile_id = v_profile_id
   where id = (
     select co.professor_id
       from public.course_offerings co
      where co.id = v_company_offering_id
   )
     and profile_id is null;

  get diagnostics v_updated = row_count;
  if v_updated > 1 then
    raise exception 'Unexpectedly updated more than one professor row: %', v_updated;
  end if;

  -- Postcondition: the target is linked to the exact demo profile.
  if not exists (
    select 1
      from public.professors p
      join public.course_offerings co on co.professor_id = p.id
     where co.id = v_company_offering_id
       and p.profile_id = v_profile_id
  ) then
    raise exception 'Postcondition failed: company-law offering is not linked to the demo profile';
  end if;

  -- Postcondition: the non-target offering and its professor row are unchanged.
  if not exists (
    select 1
      from public.course_offerings co
     where co.id = v_admin_offering_id
       and co.professor_id = v_admin_professor_id
  ) then
    raise exception 'Postcondition failed: administrative-procedure offering changed';
  end if;

  if not exists (
    select 1
      from public.professors p
     where p.id = v_admin_professor_id
       and p.profile_id is not distinct from v_admin_professor_profile_id
  ) then
    raise exception 'Postcondition failed: administrative-procedure professor linkage changed';
  end if;
end
$$;

-- Read-only post-seed verification. No student, curriculum, report, or weekly
-- plan rows are inserted by this reference seed.
select
  p.identifier,
  p.role,
  pr.id as professor_id,
  pr.profile_id,
  co.id as offering_id,
  c.name as course_name,
  t.semester_label
from public.profiles p
join public.professors pr on pr.profile_id = p.id
join public.course_offerings co on co.professor_id = pr.id
join public.courses c on c.id = co.course_id
join public.academic_terms t on t.id = co.term_id
where p.identifier = 'prof1@pacemate.edu'
  and c.name = '회사법'
  and t.semester_label = '2026-2';

commit;
