-- PaceMate reference seed: link the existing professor Auth user to the
-- existing professor profile. This file is intentionally separate from
-- migrations and must be reviewed before an explicitly approved seed run.
--
-- This seed does not create Auth users, profiles, professors, offerings, or
-- student/progress data. Its only data mutation is profiles.auth_user_id for
-- the exact existing professor profile below.

begin;

do $$
declare
  v_expected_auth_email constant text := 'prof1@pacemate.edu';
  v_expected_auth_id constant uuid := 'f89a5c0e-0569-4353-800d-16a4fb968069';
  v_expected_profile_identifier constant text := 'prof1@pacemate.edu';
  v_expected_profile_id constant uuid := 'b98be43f-1646-4910-94e5-d20de53e9dca';
  v_expected_role constant text := 'professor';
  v_expected_professor_id constant uuid := '7633254b-18cb-483d-a163-72eee0f22c97';
  v_course_name constant text := '회사법';
  v_semester_label constant text := '2026-2';
  v_auth_count integer;
  v_profile_count integer;
  v_professor_link_count integer;
  v_offering_count integer;
  v_other_auth_profile_count integer;
  v_updated integer;
  v_actual_auth_id uuid;
  v_actual_profile_id uuid;
  v_actual_profile_auth_id uuid;
  v_actual_profile_role text;
  v_actual_professor_id uuid;
  v_company_offering_id uuid;
  v_company_offering_professor_id uuid;
  v_other_profiles_before text;
  v_professors_before text;
  v_offerings_before text;
  v_student_courses_before text;
  v_student_course_progress_before text;
  v_student_weekly_progress_before text;
  v_other_profiles_after text;
  v_professors_after text;
  v_offerings_after text;
  v_student_courses_after text;
  v_student_course_progress_after text;
  v_student_weekly_progress_after text;
begin
  -- Precondition: the exact Auth email resolves to exactly the supplied Auth
  -- UUID. auth.users is read only in this seed.
  select count(*)
    into v_auth_count
    from auth.users
   where email = v_expected_auth_email;

  if v_auth_count <> 1 then
    raise exception 'Expected exactly one auth.users row for %, found %',
      v_expected_auth_email, v_auth_count;
  end if;

  select id
    into v_actual_auth_id
    from auth.users
   where email = v_expected_auth_email;

  if v_actual_auth_id <> v_expected_auth_id then
    raise exception 'Auth UUID mismatch for %: expected %, found %',
      v_expected_auth_email, v_expected_auth_id, v_actual_auth_id;
  end if;

  -- Precondition: the exact profile identifier resolves to exactly the
  -- supplied profile UUID, has the professor role, and is currently unmapped
  -- or already mapped to the same Auth UUID.
  select count(*)
    into v_profile_count
    from public.profiles
   where identifier = v_expected_profile_identifier;

  if v_profile_count <> 1 then
    raise exception 'Expected exactly one profile for %, found %',
      v_expected_profile_identifier, v_profile_count;
  end if;

  select id
    into v_actual_profile_id
    from public.profiles
   where identifier = v_expected_profile_identifier;

  if v_actual_profile_id <> v_expected_profile_id then
    raise exception 'Profile UUID mismatch for %: expected %, found %',
      v_expected_profile_identifier, v_expected_profile_id, v_actual_profile_id;
  end if;

  select p.auth_user_id, p.role::text
    into v_actual_profile_auth_id, v_actual_profile_role
    from public.profiles p
   where p.id = v_expected_profile_id;

  if v_actual_profile_role <> v_expected_role then
    raise exception 'Profile % must have role %, found %',
      v_expected_profile_identifier, v_expected_role, v_actual_profile_role;
  end if;

  if v_actual_profile_auth_id is not null
     and v_actual_profile_auth_id <> v_expected_auth_id then
    raise exception 'Profile % is already mapped to a different Auth UUID: %',
      v_expected_profile_identifier, v_actual_profile_auth_id;
  end if;

  select count(*)
    into v_other_auth_profile_count
    from public.profiles p
   where p.auth_user_id = v_expected_auth_id
     and p.id <> v_expected_profile_id;

  if v_other_auth_profile_count <> 0 then
    raise exception 'Auth UUID % is already linked to % other profile(s)',
      v_expected_auth_id, v_other_auth_profile_count;
  end if;

  -- Precondition: exactly one professor row points to this profile, and its
  -- primary key is the supplied professor UUID.
  select count(*)
    into v_professor_link_count
    from public.professors p
   where p.profile_id = v_expected_profile_id;

  if v_professor_link_count <> 1 then
    raise exception 'Expected exactly one professor row for profile %, found %',
      v_expected_profile_id, v_professor_link_count;
  end if;

  select id
    into v_actual_professor_id
    from public.professors p
   where p.profile_id = v_expected_profile_id;

  if v_actual_professor_id <> v_expected_professor_id then
    raise exception 'Professor UUID mismatch: expected %, found %',
      v_expected_professor_id, v_actual_professor_id;
  end if;

  -- Read-only precondition: identify exactly one company-law 2026-2 offering
  -- and verify that it is taught by the expected professor row.
  select count(*)
    into v_offering_count
    from public.course_offerings co
    join public.courses c on c.id = co.course_id
    join public.academic_terms t on t.id = co.term_id
   where c.name = v_course_name
     and t.semester_label = v_semester_label;

  if v_offering_count <> 1 then
    raise exception 'Expected exactly one % % offering, found %',
      v_course_name, v_semester_label, v_offering_count;
  end if;

  select co.id, co.professor_id
    into v_company_offering_id, v_company_offering_professor_id
    from public.course_offerings co
    join public.courses c on c.id = co.course_id
    join public.academic_terms t on t.id = co.term_id
   where c.name = v_course_name
     and t.semester_label = v_semester_label;

  if v_company_offering_professor_id <> v_expected_professor_id then
    raise exception 'Company-law offering % is assigned to professor %, expected %',
      v_company_offering_id, v_company_offering_professor_id, v_expected_professor_id;
  end if;

  -- Snapshot every non-target profile and all professor, offering, student
  -- enrollment, and progress rows. Any unexpected write causes a rollback.
  select md5(coalesce(jsonb_agg(to_jsonb(p) order by p.id)::text, ''))
    into v_other_profiles_before
    from public.profiles p
   where p.id <> v_expected_profile_id;

  select md5(coalesce(jsonb_agg(to_jsonb(p) order by p.id)::text, ''))
    into v_professors_before
    from public.professors p;

  select md5(coalesce(jsonb_agg(to_jsonb(co) order by co.id)::text, ''))
    into v_offerings_before
    from public.course_offerings co;

  select md5(coalesce(jsonb_agg(to_jsonb(sc) order by sc.id)::text, ''))
    into v_student_courses_before
    from public.student_courses sc;

  select md5(coalesce(jsonb_agg(to_jsonb(scp) order by scp.id)::text, ''))
    into v_student_course_progress_before
    from public.student_course_progress scp;

  select md5(coalesce(jsonb_agg(to_jsonb(swp) order by swp.id)::text, ''))
    into v_student_weekly_progress_before
    from public.student_weekly_progress swp;

  -- The sole permitted mutation: one column on the exact existing profile.
  -- An already-correct mapping is left untouched and produces row_count 0.
  update public.profiles
     set auth_user_id = v_expected_auth_id
   where id = v_expected_profile_id
     and auth_user_id is null;

  get diagnostics v_updated = row_count;
  if v_updated < 0 or v_updated > 1 then
    raise exception 'Unexpected profiles update row_count: %', v_updated;
  end if;

  -- Postcondition: the exact Auth user, profile, professor, and 2026-2
  -- company-law offering form one connected row set.
  select count(*)
    into v_auth_count
    from auth.users u
    join public.profiles p on p.auth_user_id = u.id
    join public.professors pr on pr.profile_id = p.id
    join public.course_offerings co on co.professor_id = pr.id
    join public.courses c on c.id = co.course_id
    join public.academic_terms t on t.id = co.term_id
   where u.id = v_expected_auth_id
     and u.email = v_expected_auth_email
     and p.id = v_expected_profile_id
     and p.identifier = v_expected_profile_identifier
     and p.role::text = v_expected_role
     and pr.id = v_expected_professor_id
     and co.id = v_company_offering_id
     and c.name = v_course_name
     and t.semester_label = v_semester_label;

  if v_auth_count <> 1 then
    raise exception 'Postcondition failed: exact Auth-profile-professor-offering link not found';
  end if;

  -- Re-verify the read-only offering connection explicitly.
  select count(*)
    into v_offering_count
    from public.course_offerings co
    join public.courses c on c.id = co.course_id
    join public.academic_terms t on t.id = co.term_id
   where c.name = v_course_name
     and t.semester_label = v_semester_label
     and co.id = v_company_offering_id;

  select co.professor_id
    into v_company_offering_professor_id
    from public.course_offerings co
   where co.id = v_company_offering_id;

  if v_offering_count <> 1
     or v_company_offering_professor_id <> v_expected_professor_id then
    raise exception 'Postcondition failed: company-law % offering connection changed',
      v_semester_label;
  end if;

  -- Verify no other professor/profile/offering/student/progress row changed.
  select md5(coalesce(jsonb_agg(to_jsonb(p) order by p.id)::text, ''))
    into v_other_profiles_after
    from public.profiles p
   where p.id <> v_expected_profile_id;

  select md5(coalesce(jsonb_agg(to_jsonb(p) order by p.id)::text, ''))
    into v_professors_after
    from public.professors p;

  select md5(coalesce(jsonb_agg(to_jsonb(co) order by co.id)::text, ''))
    into v_offerings_after
    from public.course_offerings co;

  select md5(coalesce(jsonb_agg(to_jsonb(sc) order by sc.id)::text, ''))
    into v_student_courses_after
    from public.student_courses sc;

  select md5(coalesce(jsonb_agg(to_jsonb(scp) order by scp.id)::text, ''))
    into v_student_course_progress_after
    from public.student_course_progress scp;

  select md5(coalesce(jsonb_agg(to_jsonb(swp) order by swp.id)::text, ''))
    into v_student_weekly_progress_after
    from public.student_weekly_progress swp;

  if v_other_profiles_before is distinct from v_other_profiles_after
     or v_professors_before is distinct from v_professors_after
     or v_offerings_before is distinct from v_offerings_after
     or v_student_courses_before is distinct from v_student_courses_after
     or v_student_course_progress_before is distinct from v_student_course_progress_after
     or v_student_weekly_progress_before is distinct from v_student_weekly_progress_after then
    raise exception 'Postcondition failed: an unexpected professor/profile/offering/student/progress row changed';
  end if;
end
$$;

commit;

-- Read-only result after the transaction. No additional mutation is performed.
select
  u.email as auth_email,
  u.id as auth_user_id,
  p.identifier as profile_identifier,
  p.id as profile_id,
  p.role,
  p.auth_user_id,
  pr.id as professor_id,
  co.id as offering_id,
  c.name as course_name,
  t.semester_label
from auth.users u
join public.profiles p on p.auth_user_id = u.id
join public.professors pr on pr.profile_id = p.id
join public.course_offerings co on co.professor_id = pr.id
join public.courses c on c.id = co.course_id
join public.academic_terms t on t.id = co.term_id
where u.id = 'f89a5c0e-0569-4353-800d-16a4fb968069'::uuid
  and u.email = 'prof1@pacemate.edu'
  and p.id = 'b98be43f-1646-4910-94e5-d20de53e9dca'::uuid
  and p.identifier = 'prof1@pacemate.edu'
  and p.role = 'professor'
  and pr.id = '7633254b-18cb-483d-a163-72eee0f22c97'::uuid
  and c.name = '회사법'
  and t.semester_label = '2026-2';
