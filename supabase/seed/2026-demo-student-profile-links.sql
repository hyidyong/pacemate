-- PaceMate demo reference seed: link existing Supabase Auth users to profiles.
--
-- This seed never creates auth.users rows and never copies real user names.
-- It is intentionally separate from migrations and must be reviewed before
-- execution against the project.

begin;

do $$
declare
  v_target record;
  v_auth_user_id uuid;
  v_existing_identifier text;
  v_existing_role public.user_role;
  v_count integer;
  v_non_target_profile_count integer;
  v_target_student_profile_count integer;
  v_student1_id uuid;
  v_student1_identifier text;
  v_student1_role public.user_role;
begin
  -- Snapshot a known existing demo profile and non-target profile count. The
  -- seed may only add the four allowlisted profile rows below.
  select count(*)
    into v_count
    from public.profiles
   where identifier = 'student1@pacemate.edu';

  if v_count <> 1 then
    raise exception 'Expected exactly one existing student1 profile; found %', v_count;
  end if;

  select id, identifier, role
    into v_student1_id, v_student1_identifier, v_student1_role
    from public.profiles
   where identifier = 'student1@pacemate.edu';

  if v_student1_role <> 'student' then
    raise exception 'Existing student1 profile must have role student';
  end if;

  select count(*)
    into v_non_target_profile_count
    from public.profiles
   where identifier not in (
     'student2@pacemate.edu',
     'student3@pacemate.edu',
     'student4@pacemate.edu',
     'student5@pacemate.edu'
   );

  select count(*)
    into v_target_student_profile_count
    from public.student_profiles sp
    join public.profiles p on p.id = sp.profile_id
   where p.identifier in (
     'student2@pacemate.edu',
     'student3@pacemate.edu',
     'student4@pacemate.edu',
     'student5@pacemate.edu'
   );

  for v_target in
    select *
      from (values
        ('student2@pacemate.edu', 'Demo Student 2'),
        ('student3@pacemate.edu', 'Demo Student 3'),
        ('student4@pacemate.edu', 'Demo Student 4'),
        ('student5@pacemate.edu', 'Demo Student 5')
      ) as allowlist(identifier, display_name)
  loop
    -- Fail closed if an allowlisted email is missing or duplicated in Auth.
    select count(*)
      into v_count
      from auth.users
     where email = v_target.identifier;

    if v_count <> 1 then
      raise exception 'Expected exactly one auth user for %; found %', v_target.identifier, v_count;
    end if;

    -- Use the actual Auth UUID; no UUID literal or generated UUID is used.
    select id
      into v_auth_user_id
      from auth.users
     where email = v_target.identifier;

    select count(*)
      into v_count
      from public.profiles
     where id = v_auth_user_id;

    if v_count > 1 then
      raise exception 'Multiple profiles found for auth user %', v_target.identifier;
    end if;

    if v_count = 1 then
      select identifier, role
        into v_existing_identifier, v_existing_role
        from public.profiles
       where id = v_auth_user_id;

      if v_existing_identifier <> v_target.identifier then
        raise exception 'Auth user % is already linked to a different profile identifier', v_target.identifier;
      end if;

      if v_existing_role <> 'student' then
        raise exception 'Existing profile for % must have role student', v_target.identifier;
      end if;

      -- Same id, identifier, and role: idempotent no-op.
    else
      select count(*)
        into v_count
        from public.profiles
       where identifier = v_target.identifier;

      if v_count <> 0 then
        raise exception 'Profile identifier % is already owned by another id', v_target.identifier;
      end if;

      insert into public.profiles (id, identifier, name, role)
      values (v_auth_user_id, v_target.identifier, v_target.display_name, 'student');
    end if;
  end loop;

  -- Postcondition: each allowlisted Auth user has exactly one matching
  -- student profile with the same UUID and identifier.
  for v_target in
    select *
      from (values
        ('student2@pacemate.edu'),
        ('student3@pacemate.edu'),
        ('student4@pacemate.edu'),
        ('student5@pacemate.edu')
      ) as allowlist(identifier)
  loop
    select count(*)
      into v_count
      from auth.users u
      join public.profiles p on p.id = u.id
     where u.email = v_target.identifier
       and p.identifier = v_target.identifier
       and p.role = 'student';

    if v_count <> 1 then
      raise exception 'Postcondition failed for %; matching student profile count is %', v_target.identifier, v_count;
    end if;
  end loop;

  -- Non-target profiles and student_profiles are not modified by this seed.
  select count(*)
    into v_count
    from public.profiles
   where identifier not in (
     'student2@pacemate.edu',
     'student3@pacemate.edu',
     'student4@pacemate.edu',
     'student5@pacemate.edu'
   );

  if v_count <> v_non_target_profile_count then
    raise exception 'Non-target profile count changed from % to %', v_non_target_profile_count, v_count;
  end if;

  select count(*)
    into v_count
    from public.student_profiles sp
    join public.profiles p on p.id = sp.profile_id
   where p.identifier in (
     'student2@pacemate.edu',
     'student3@pacemate.edu',
     'student4@pacemate.edu',
     'student5@pacemate.edu'
   );

  if v_count <> v_target_student_profile_count then
    raise exception 'Target student_profiles count changed from % to %', v_target_student_profile_count, v_count;
  end if;

  if not exists (
    select 1
      from public.profiles
     where id = v_student1_id
       and identifier = v_student1_identifier
       and role = v_student1_role
  ) then
    raise exception 'Postcondition failed: student1 profile changed';
  end if;
end
$$;

-- Read-only verification. No student_profiles, student_courses, progress,
-- curriculum, report, professor, or Auth rows are created by this seed.
select
  u.email,
  u.id as auth_user_id,
  p.id as profile_id,
  p.identifier,
  p.role
from auth.users u
join public.profiles p on p.id = u.id
where u.email in (
  'student2@pacemate.edu',
  'student3@pacemate.edu',
  'student4@pacemate.edu',
  'student5@pacemate.edu'
)
order by u.email;

commit;
