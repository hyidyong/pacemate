begin;

-- 8-4B: map only existing Auth users to existing profiles.
-- No auth.users row is created and no profile/progress identity is rewritten.
do $$
declare
  item record;
  auth_count integer;
  profile_count integer;
  auth_id uuid;
  existing_auth_id uuid;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'auth_user_id'
      and udt_name = 'uuid'
  ) then
    raise exception 'profiles.auth_user_id schema migration is required first';
  end if;

  for item in
    select * from (values
      ('student1@pacemate.edu'::text, 'student1@pacemate.edu'::text),
      ('student2@pacemate.edu'::text, 'student2@pacemate.edu'::text),
      ('student3@pacemate.edu'::text, 'student3@pacemate.edu'::text),
      ('student4@pacemate.edu'::text, 'student4@pacemate.edu'::text),
      ('student5@pacemate.edu'::text, 'student5@pacemate.edu'::text)
    ) as expected(auth_email, profile_identifier)
  loop
    select count(*) into auth_count
    from auth.users u
    where lower(u.email) = lower(item.auth_email);

    if auth_count <> 1 then
      raise exception 'Expected exactly one auth.users row for %; found %', item.auth_email, auth_count;
    end if;

    select count(*) into profile_count
    from public.profiles p
    where p.identifier = item.profile_identifier;

    if profile_count <> 1 then
      raise exception 'Expected exactly one public.profiles row for %; found %', item.profile_identifier, profile_count;
    end if;

    select u.id into auth_id
    from auth.users u
    where lower(u.email) = lower(item.auth_email);

    if not exists (
      select 1 from public.profiles p
      where p.identifier = item.profile_identifier
        and p.role = 'student'
    ) then
      raise exception 'Profile % must have role student', item.profile_identifier;
    end if;

    select p.auth_user_id into existing_auth_id
    from public.profiles p
    where p.identifier = item.profile_identifier;

    if existing_auth_id is not null and existing_auth_id <> auth_id then
      raise exception 'Profile % is already mapped to a different Auth user', item.profile_identifier;
    end if;

    if exists (
      select 1 from public.profiles p
      where p.auth_user_id = auth_id
        and p.identifier <> item.profile_identifier
    ) then
      raise exception 'Auth user % is already mapped to another profile', auth_id;
    end if;
  end loop;

  if exists (
    with expected(auth_email, profile_identifier) as (
      values
        ('student1@pacemate.edu'::text, 'student1@pacemate.edu'::text),
        ('student2@pacemate.edu'::text, 'student2@pacemate.edu'::text),
        ('student3@pacemate.edu'::text, 'student3@pacemate.edu'::text),
        ('student4@pacemate.edu'::text, 'student4@pacemate.edu'::text),
        ('student5@pacemate.edu'::text, 'student5@pacemate.edu'::text)
    )
    select u.id
    from expected e
    join auth.users u on lower(u.email) = lower(e.auth_email)
    group by u.id
    having count(*) > 1
  ) then
    raise exception 'One Auth user resolves to multiple mapping targets';
  end if;
end
$$;

do $$
declare
  before_weekly_count bigint;
  after_weekly_count bigint;
  before_course_count bigint;
  after_course_count bigint;
  before_weekly_ids uuid[];
  after_weekly_ids uuid[];
  before_course_ids uuid[];
  after_course_ids uuid[];
  before_profile_ids uuid[];
  after_profile_ids uuid[];
begin
  select count(*), coalesce(array_agg(student_id order by id), '{}'::uuid[])
    into before_weekly_count, before_weekly_ids
  from public.student_weekly_progress;

  select count(*), coalesce(array_agg(student_id order by id), '{}'::uuid[])
    into before_course_count, before_course_ids
  from public.student_course_progress;

  select coalesce(array_agg(id order by id), '{}'::uuid[])
    into before_profile_ids
  from public.profiles;

  with expected(auth_email, profile_identifier) as (
    values
      ('student1@pacemate.edu'::text, 'student1@pacemate.edu'::text),
      ('student2@pacemate.edu'::text, 'student2@pacemate.edu'::text),
      ('student3@pacemate.edu'::text, 'student3@pacemate.edu'::text),
      ('student4@pacemate.edu'::text, 'student4@pacemate.edu'::text),
      ('student5@pacemate.edu'::text, 'student5@pacemate.edu'::text)
  )
  update public.profiles p
  set auth_user_id = u.id
  from expected e
  join auth.users u on lower(u.email) = lower(e.auth_email)
  where p.identifier = e.profile_identifier
    and p.auth_user_id is distinct from u.id;

  select count(*), coalesce(array_agg(student_id order by id), '{}'::uuid[])
    into after_weekly_count, after_weekly_ids
  from public.student_weekly_progress;

  select count(*), coalesce(array_agg(student_id order by id), '{}'::uuid[])
    into after_course_count, after_course_ids
  from public.student_course_progress;

  select coalesce(array_agg(id order by id), '{}'::uuid[])
    into after_profile_ids
  from public.profiles;

  if before_weekly_count <> after_weekly_count
     or before_weekly_ids is distinct from after_weekly_ids then
    raise exception 'student_weekly_progress identity or row count changed during mapping';
  end if;

  if before_course_count <> after_course_count
     or before_course_ids is distinct from after_course_ids then
    raise exception 'student_course_progress identity or row count changed during mapping';
  end if;

  if before_profile_ids is distinct from after_profile_ids then
    raise exception 'profiles.id changed during Auth mapping';
  end if;
end
$$;

do $$
begin
  if exists (
    with expected(auth_email, profile_identifier) as (
      values
        ('student1@pacemate.edu'::text, 'student1@pacemate.edu'::text),
        ('student2@pacemate.edu'::text, 'student2@pacemate.edu'::text),
        ('student3@pacemate.edu'::text, 'student3@pacemate.edu'::text),
        ('student4@pacemate.edu'::text, 'student4@pacemate.edu'::text),
        ('student5@pacemate.edu'::text, 'student5@pacemate.edu'::text)
    )
    select 1
    from expected e
    left join auth.users u on lower(u.email) = lower(e.auth_email)
    left join public.profiles p on p.identifier = e.profile_identifier
    where u.id is null
      or p.id is null
      or p.auth_user_id is distinct from u.id
      or p.role <> 'student'
  ) then
    raise exception 'Not all five demo Auth profiles were mapped and verified';
  end if;
end
$$;

commit;
