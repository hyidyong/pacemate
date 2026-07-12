begin;

do $$
declare
  policy_qual text;
  existing_professor_column_grant_count integer;
  unexpected_select_column_count integer;
  selected_column_count integer;
  table_write_grant_count_before integer;
  table_write_grant_count_after integer;
  column_write_grant_count_before integer;
  column_write_grant_count_after integer;
  write_policy_count_before integer;
  write_policy_count_after integer;
begin
  if not exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'course_offerings'
  ) then
    raise exception 'Required table public.course_offerings does not exist';
  end if;

  if not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'course_offerings'
      and c.relkind = 'r'
      and c.relrowsecurity
  ) then
    raise exception 'RLS must be enabled on public.course_offerings';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'course_offerings'
      and column_name = 'professor_id'
      and udt_name = 'uuid'
  ) then
    raise exception 'public.course_offerings.professor_id uuid column is required';
  end if;

  select qual
    into policy_qual
    from pg_policies
   where schemaname = 'public'
     and tablename = 'course_offerings'
     and policyname = 'professors read own course offerings'
     and cmd = 'SELECT'
     and roles @> ARRAY['authenticated']::name[]
     and cardinality(roles) = 1;

  if policy_qual is null then
    raise exception 'Expected authenticated SELECT policy professors read own course offerings was not found';
  end if;

  if position('professor_id' in lower(policy_qual)) = 0
     or position('course_offerings' in lower(policy_qual)) = 0 then
    raise exception 'Professor course-offering policy does not reference course_offerings.professor_id';
  end if;

  select count(*)
    into existing_professor_column_grant_count
    from information_schema.column_privileges
   where table_schema = 'public'
     and table_name = 'course_offerings'
     and grantee = 'authenticated'
     and privilege_type = 'SELECT'
     and column_name = 'professor_id';

  if existing_professor_column_grant_count <> 0 then
    raise exception 'authenticated already has SELECT on course_offerings.professor_id';
  end if;

  select count(*)
    into unexpected_select_column_count
    from information_schema.column_privileges
   where table_schema = 'public'
     and table_name = 'course_offerings'
     and grantee = 'authenticated'
     and privilege_type = 'SELECT'
     and column_name not in ('id', 'course_id', 'term_id');

  if unexpected_select_column_count <> 0 then
    raise exception 'course_offerings has unexpected authenticated SELECT column grants';
  end if;

  select count(*)
    into table_write_grant_count_before
    from information_schema.table_privileges
   where table_schema = 'public'
     and table_name = 'course_offerings'
     and grantee = 'authenticated'
     and privilege_type in ('INSERT', 'UPDATE', 'DELETE');

  select count(*)
    into column_write_grant_count_before
    from information_schema.column_privileges
   where table_schema = 'public'
     and table_name = 'course_offerings'
     and grantee = 'authenticated'
     and privilege_type in ('INSERT', 'UPDATE', 'DELETE');

  select count(*)
    into write_policy_count_before
    from pg_policies
   where schemaname = 'public'
     and tablename = 'course_offerings'
     and cmd in ('INSERT', 'UPDATE', 'DELETE');

  grant select (professor_id)
    on public.course_offerings to authenticated;

  select count(*)
    into selected_column_count
    from information_schema.column_privileges
   where table_schema = 'public'
     and table_name = 'course_offerings'
     and grantee = 'authenticated'
     and privilege_type = 'SELECT'
     and column_name in ('id', 'course_id', 'term_id', 'professor_id');

  if selected_column_count <> 4 then
    raise exception 'Expected exactly four authenticated SELECT columns on course_offerings, found %',
      selected_column_count;
  end if;

  select count(*)
    into unexpected_select_column_count
    from information_schema.column_privileges
   where table_schema = 'public'
     and table_name = 'course_offerings'
     and grantee = 'authenticated'
     and privilege_type = 'SELECT'
     and column_name not in ('id', 'course_id', 'term_id', 'professor_id');

  if unexpected_select_column_count <> 0 then
    raise exception 'course_offerings has unexpected authenticated SELECT columns after grant';
  end if;

  select count(*)
    into existing_professor_column_grant_count
    from information_schema.column_privileges
   where table_schema = 'public'
     and table_name = 'course_offerings'
     and grantee = 'authenticated'
     and privilege_type = 'SELECT'
     and column_name = 'professor_id';

  if existing_professor_column_grant_count <> 1 then
    raise exception 'Expected exactly one authenticated SELECT grant for professor_id, found %',
      existing_professor_column_grant_count;
  end if;

  select count(*)
    into table_write_grant_count_after
    from information_schema.table_privileges
   where table_schema = 'public'
     and table_name = 'course_offerings'
     and grantee = 'authenticated'
     and privilege_type in ('INSERT', 'UPDATE', 'DELETE');

  select count(*)
    into column_write_grant_count_after
    from information_schema.column_privileges
   where table_schema = 'public'
     and table_name = 'course_offerings'
     and grantee = 'authenticated'
     and privilege_type in ('INSERT', 'UPDATE', 'DELETE');

  if table_write_grant_count_after <> table_write_grant_count_before
     or column_write_grant_count_after <> column_write_grant_count_before then
    raise exception 'Existing course_offerings write grants changed';
  end if;

  select count(*)
    into write_policy_count_after
    from pg_policies
   where schemaname = 'public'
     and tablename = 'course_offerings'
     and cmd in ('INSERT', 'UPDATE', 'DELETE');

  if write_policy_count_after <> write_policy_count_before then
    raise exception 'Existing course_offerings write policy count changed';
  end if;
end
$$;

commit;
