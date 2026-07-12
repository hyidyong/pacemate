begin;

-- 8-4C: Auth-mapped, read-only eligibility access. No courses policy changes.
do $$
declare
  item record;
  mapping_count integer;
  existing_qual text;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'auth_user_id'
      and udt_name = 'uuid'
  ) then
    raise exception 'profiles.auth_user_id is required before eligibility policies';
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
    select count(*) into mapping_count
    from public.profiles p
    join auth.users u on u.id = p.auth_user_id
    where p.identifier = item.profile_identifier
      and lower(u.email) = lower(item.auth_email)
      and p.role = 'student';

    if mapping_count <> 1 then
      raise exception 'Auth-profile mapping is incomplete for %', item.profile_identifier;
    end if;
  end loop;

  for item in
    select table_name
    from (values
      ('profiles'::text),
      ('student_weekly_progress'::text),
      ('course_weekly_plans'::text),
      ('course_offerings'::text),
      ('academic_terms'::text)
    ) as expected(table_name)
  loop
    if not exists (
      select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = item.table_name
        and c.relrowsecurity
    ) then
      raise exception 'RLS must remain enabled on public.%', item.table_name;
    end if;
  end loop;

  for item in
    select * from (values
      ('student_weekly_progress'::text, 'students read own weekly progress'::text),
      ('course_weekly_plans'::text, 'students read approved weekly plans'::text),
      ('course_offerings'::text, 'students read own course offerings'::text),
      ('academic_terms'::text, 'students read own academic terms'::text)
    ) as expected(table_name, policy_name)
  loop
    if exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = item.table_name
        and policyname = item.policy_name
    ) then
      raise exception 'Eligibility policy name already exists on %.%', item.table_name, item.policy_name;
    end if;
  end loop;

  select qual into existing_qual
  from pg_policies
  where schemaname = 'public'
    and tablename = 'profiles'
    and policyname = 'users read own profile'
    and cmd = 'SELECT'
    and permissive = 'PERMISSIVE'
    and roles @> ARRAY['authenticated']::name[]
    and cardinality(roles) = 1;

  if existing_qual is null
     or regexp_replace(lower(existing_qual), '\s+', '', 'g') <> '((selectauth.uid()asuid)=id)' then
    raise exception 'Expected existing profiles own-read policy was not found with the reviewed definition';
  end if;

  if exists (
    select 1
    from information_schema.column_privileges
    where table_schema = 'public'
      and table_name = 'student_weekly_progress'
      and grantee = 'authenticated'
      and privilege_type = 'SELECT'
      and column_name in ('private_note', 'shared_feedback', 'share_feedback_with_professor', 'use_private_note_for_ai')
  ) then
    raise exception 'Sensitive student progress columns already have authenticated SELECT grants';
  end if;

  if exists (
    select 1
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name in ('student_weekly_progress', 'course_weekly_plans', 'course_offerings', 'academic_terms')
      and grantee in ('anon', 'public')
      and privilege_type = 'SELECT'
  ) then
    raise exception 'Unexpected anon/public SELECT grant exists on an eligibility table';
  end if;
end
$$;

drop policy "users read own profile" on public.profiles;
create policy "users read own profile"
  on public.profiles
  for select
  to authenticated
  using ((select auth.uid()) = auth_user_id);

revoke select on table
  public.student_weekly_progress,
  public.course_weekly_plans,
  public.course_offerings,
  public.academic_terms
from authenticated;

grant select (student_id, offering_id, week_number, progress_status_override)
  on public.student_weekly_progress to authenticated;
grant select (offering_id, week_number, review_required, professor_confirmed)
  on public.course_weekly_plans to authenticated;
grant select (id, course_id, term_id)
  on public.course_offerings to authenticated;
grant select (id, semester_label)
  on public.academic_terms to authenticated;
grant select (id, auth_user_id, role)
  on public.profiles to authenticated;

create policy "students read own weekly progress"
  on public.student_weekly_progress
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = student_weekly_progress.student_id
        and p.auth_user_id = (select auth.uid())
        and p.role = 'student'
    )
  );

create policy "students read approved weekly plans"
  on public.course_weekly_plans
  for select
  to authenticated
  using (
    review_required = false
    and professor_confirmed = true
    and exists (
      select 1
      from public.student_weekly_progress swp
      join public.profiles p on p.id = swp.student_id
      where swp.offering_id = course_weekly_plans.offering_id
        and p.auth_user_id = (select auth.uid())
        and p.role = 'student'
    )
  );

create policy "students read own course offerings"
  on public.course_offerings
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.student_weekly_progress swp
      join public.profiles p on p.id = swp.student_id
      where swp.offering_id = course_offerings.id
        and p.auth_user_id = (select auth.uid())
        and p.role = 'student'
    )
  );

create policy "students read own academic terms"
  on public.academic_terms
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.course_offerings co
      join public.student_weekly_progress swp on swp.offering_id = co.id
      join public.profiles p on p.id = swp.student_id
      where co.term_id = academic_terms.id
        and p.auth_user_id = (select auth.uid())
        and p.role = 'student'
    )
  );

do $$
begin
  if exists (
    select 1
    from information_schema.column_privileges
    where table_schema = 'public'
      and table_name = 'student_weekly_progress'
      and grantee = 'authenticated'
      and privilege_type = 'SELECT'
      and column_name in ('private_note', 'shared_feedback', 'share_feedback_with_professor', 'use_private_note_for_ai')
  ) then
    raise exception 'Sensitive student progress columns were granted unexpectedly';
  end if;
end
$$;

commit;
