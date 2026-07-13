begin;

do $$
declare
  current_select_columns text[];
begin
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'student_weekly_progress'
      and c.relkind = 'r' and c.relrowsecurity
  ) then
    raise exception 'student_weekly_progress must exist with RLS enabled';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'student_weekly_progress'
      and policyname = 'professors read own weekly aggregate evidence'
  ) then
    raise exception 'Professor weekly aggregate policy already exists';
  end if;

  select array_agg(column_name order by column_name)
    into current_select_columns
    from information_schema.column_privileges
   where table_schema = 'public' and table_name = 'student_weekly_progress'
     and grantee = 'authenticated' and privilege_type = 'SELECT';

  if current_select_columns is distinct from array[
    'offering_id', 'progress_status_override', 'student_id', 'week_number'
  ]::text[] then
    raise exception 'Unexpected authenticated weekly-progress grants: %', current_select_columns;
  end if;

  create policy "professors read own weekly aggregate evidence"
    on public.student_weekly_progress
    for select
    to authenticated
    using (
      exists (
        select 1
        from public.course_offerings offering
        join public.professors professor on professor.id = offering.professor_id
        join public.profiles professor_profile on professor_profile.id = professor.profile_id
        where offering.id = student_weekly_progress.offering_id
          and professor_profile.auth_user_id = (select auth.uid())
          and professor_profile.role = 'professor'
      )
    );

  grant select (difficulty_level, understanding_level)
    on public.student_weekly_progress to authenticated;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'student_weekly_progress'
      and policyname = 'professors read own weekly aggregate evidence'
      and cmd = 'SELECT'
      and roles = array['authenticated']::name[]
  ) then
    raise exception 'Professor weekly aggregate policy verification failed';
  end if;

  if (
    select count(*) from information_schema.column_privileges
    where table_schema = 'public' and table_name = 'student_weekly_progress'
      and grantee = 'authenticated' and privilege_type = 'SELECT'
      and column_name in ('difficulty_level', 'understanding_level')
  ) <> 2 then
    raise exception 'Professor aggregate column grant verification failed';
  end if;
end
$$;

commit;
