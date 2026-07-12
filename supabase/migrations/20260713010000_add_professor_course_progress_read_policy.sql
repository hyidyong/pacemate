begin;

-- Roadmap 9-2: authenticated professors may read only the aggregate student
-- course progress rows belonging to their own course offerings.
-- No student_weekly_progress or profiles student-read policy is added here.
do $$
declare
  table_exists boolean;
  policy_count integer;
  write_policy_count_before integer;
  write_policy_count_after integer;
  selected_column_count integer;
  forbidden_column_count integer;
  expected_policy_count integer;
  course_offerings_student_policy_qual text;
begin
  if not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'student_course_progress'
      and c.relkind = 'r'
  ) then
    raise exception 'Required table public.student_course_progress does not exist';
  end if;

  select exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'student_course_progress'
      and c.relkind = 'r'
      and c.relrowsecurity
  )
    into table_exists;

  if not table_exists then
    raise exception 'RLS must be enabled on public.student_course_progress';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'auth_user_id'
      and udt_name = 'uuid'
  ) then
    raise exception 'profiles.auth_user_id uuid column is required';
  end if;

  select count(*)
    into policy_count
    from pg_policies
   where schemaname = 'public'
     and (
       (tablename = 'course_offerings'
        and policyname = 'professors read own course offerings')
       or
       (tablename = 'student_course_progress'
        and policyname = 'professors read own student course progress')
     );

  if policy_count <> 0 then
    raise exception 'One or more professor eligibility policies already exist';
  end if;

  -- Preserve the existing student ownership policies. In particular, the
  -- existing course-offering policy may read student_weekly_progress, but it
  -- must not already depend on student_course_progress.
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'course_offerings'
      and policyname = 'students read own course offerings'
      and cmd = 'SELECT'
      and roles @> ARRAY['authenticated']::name[]
      and cardinality(roles) = 1
  ) then
    raise exception 'Existing student course-offering SELECT policy was not found';
  end if;

  select qual
    into course_offerings_student_policy_qual
    from pg_policies
   where schemaname = 'public'
     and tablename = 'course_offerings'
     and policyname = 'students read own course offerings'
     and cmd = 'SELECT'
     and roles @> ARRAY['authenticated']::name[]
     and cardinality(roles) = 1;

  if position('student_course_progress' in coalesce(course_offerings_student_policy_qual, '')) > 0 then
    raise exception 'Existing student course-offering policy already references student_course_progress';
  end if;

  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename in ('course_offerings', 'professors', 'profiles')
      and position(
        'student_course_progress'
        in lower(coalesce(qual, '') || ' ' || coalesce(with_check, ''))
      ) > 0
  ) then
    raise exception 'An existing ownership policy would create a path back to student_course_progress';
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'student_weekly_progress'
      and policyname = 'students read own weekly progress'
      and cmd = 'SELECT'
      and roles @> ARRAY['authenticated']::name[]
      and cardinality(roles) = 1
  ) then
    raise exception 'Existing student weekly-progress SELECT policy was not found';
  end if;

  -- Only the five evidence columns may be SELECT-granted to authenticated.
  -- Any pre-existing grant on id, timestamps, or another column fails closed.
  select count(*)
    into forbidden_column_count
    from information_schema.column_privileges
   where table_schema = 'public'
     and table_name = 'student_course_progress'
     and grantee = 'authenticated'
     and privilege_type = 'SELECT'
     and column_name not in (
       'student_id',
       'offering_id',
       'last_completed_week',
       'status',
       'last_activity_at'
     );

  if forbidden_column_count <> 0 then
    raise exception 'student_course_progress has unexpected authenticated SELECT grants';
  end if;

  select count(*)
    into write_policy_count_before
    from pg_policies
   where schemaname = 'public'
     and tablename in ('course_offerings', 'student_course_progress')
     and cmd in ('INSERT', 'UPDATE', 'DELETE');

  create index if not exists student_course_progress_offering_idx
    on public.student_course_progress(offering_id);

  -- The offering policy is deliberately limited to professors and does not
  -- read student_course_progress or student_weekly_progress.
  create policy "professors read own course offerings"
    on public.course_offerings
    for select
    to authenticated
    using (
      exists (
        select 1
        from public.professors professor
        join public.profiles professor_profile
          on professor_profile.id = professor.profile_id
        where professor.id = course_offerings.professor_id
          and professor_profile.auth_user_id = (select auth.uid())
          and professor_profile.role = 'professor'
      )
    );

  -- Ownership chain:
  -- auth.uid()
  --   -> profiles.auth_user_id
  --   -> professors.profile_id
  --   -> course_offerings.professor_id
  --   -> student_course_progress.offering_id
  create policy "professors read own student course progress"
    on public.student_course_progress
    for select
    to authenticated
    using (
      exists (
        select 1
        from public.course_offerings offering
        join public.professors professor
          on professor.id = offering.professor_id
        join public.profiles professor_profile
          on professor_profile.id = professor.profile_id
        where offering.id = student_course_progress.offering_id
          and professor_profile.auth_user_id = (select auth.uid())
          and professor_profile.role = 'professor'
      )
    );

  -- Exactly two new policies, and both must be SELECT-only for authenticated.
  select count(*)
    into expected_policy_count
    from pg_policies policy
    join (values
      ('course_offerings'::text, 'professors read own course offerings'::text),
      ('student_course_progress'::text, 'professors read own student course progress'::text)
    ) as expected(tablename, policyname)
      on expected.tablename = policy.tablename
     and expected.policyname = policy.policyname
   where policy.schemaname = 'public'
     and policy.cmd = 'SELECT'
     and policy.roles @> ARRAY['authenticated']::name[]
     and cardinality(policy.roles) = 1;

  if expected_policy_count <> 2 then
    raise exception 'Expected exactly two authenticated SELECT policies, found %', expected_policy_count;
  end if;

  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and (
        (tablename = 'course_offerings'
         and policyname = 'professors read own course offerings')
        or
        (tablename = 'student_course_progress'
         and policyname = 'professors read own student course progress')
      )
      and cmd <> 'SELECT'
  ) then
    raise exception 'A professor eligibility policy is not SELECT-only';
  end if;

  select count(*)
    into write_policy_count_after
    from pg_policies
   where schemaname = 'public'
     and tablename in ('course_offerings', 'student_course_progress')
     and cmd in ('INSERT', 'UPDATE', 'DELETE');

  if write_policy_count_after <> write_policy_count_before then
    raise exception 'Existing write policy count changed from % to %',
      write_policy_count_before, write_policy_count_after;
  end if;

  -- The grant must expose exactly the five non-sensitive evidence columns;
  -- id, created_at, updated_at, and any future/unlisted column are rejected.
  select count(*)
    into forbidden_column_count
    from information_schema.column_privileges
   where table_schema = 'public'
     and table_name = 'student_course_progress'
     and grantee = 'authenticated'
     and privilege_type = 'SELECT'
     and column_name not in (
       'student_id',
       'offering_id',
       'last_completed_week',
       'status',
       'last_activity_at'
     );

  if forbidden_column_count <> 0 then
    raise exception 'Unexpected authenticated SELECT grant remains on student_course_progress';
  end if;

  grant select (
    student_id,
    offering_id,
    last_completed_week,
    status,
    last_activity_at
  ) on public.student_course_progress to authenticated;

  select count(*)
    into selected_column_count
    from information_schema.column_privileges
   where table_schema = 'public'
     and table_name = 'student_course_progress'
     and grantee = 'authenticated'
     and privilege_type = 'SELECT'
     and column_name in (
       'student_id',
       'offering_id',
       'last_completed_week',
       'status',
       'last_activity_at'
     );

  if selected_column_count <> 5 then
    raise exception 'Expected five authenticated SELECT grant columns, found %', selected_column_count;
  end if;

  if not exists (
    select 1
    from pg_class index_relation
    join pg_namespace index_schema
      on index_schema.oid = index_relation.relnamespace
    where index_schema.nspname = 'public'
      and index_relation.relname = 'student_course_progress_offering_idx'
      and index_relation.relkind = 'i'
  ) then
    raise exception 'Required offering_id index was not created';
  end if;
end
$$;

commit;
