begin;

create temporary table _counseling_untouched_policy_baseline on commit drop as
select policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename = 'counseling_requests'
  and policyname not in (
    'users create counseling requests',
    'users read own counseling requests',
    'demo anon create counseling requests',
    'demo anon read counseling requests'
  );

do $$
declare
  insert_policy record;
  select_policy record;
  anon_insert_policy record;
  anon_select_policy record;
begin
  if to_regclass('public.counseling_requests') is null
     or to_regclass('public.profiles') is null then
    raise exception 'Required counseling ownership tables are missing';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'auth_user_id'
      and udt_name = 'uuid'
  ) then
    raise exception 'profiles.auth_user_id uuid mapping is required';
  end if;

  if not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'counseling_requests'
      and c.relkind = 'r'
      and c.relrowsecurity
  ) then
    raise exception 'RLS must be enabled on public.counseling_requests';
  end if;

  select * into insert_policy
  from pg_policies
  where schemaname = 'public'
    and tablename = 'counseling_requests'
    and policyname = 'users create counseling requests';

  -- Existing environments have equivalent policies with slightly different
  -- normalized SQL formatting. The migration replaces this policy below, so
  -- only its existence and command kind are a safe compatibility precondition.
  if not found or insert_policy.cmd <> 'INSERT' then
    raise exception 'Reviewed counseling INSERT policy definition was not found';
  end if;

  select * into select_policy
  from pg_policies
  where schemaname = 'public'
    and tablename = 'counseling_requests'
    and policyname = 'users read own counseling requests';

  if not found or select_policy.cmd <> 'SELECT' then
    raise exception 'Reviewed counseling SELECT policy definition was not found';
  end if;

  select * into anon_insert_policy
  from pg_policies
  where schemaname = 'public'
    and tablename = 'counseling_requests'
    and policyname = 'demo anon create counseling requests';

  if not found or anon_insert_policy.cmd <> 'INSERT' then
    raise exception 'Reviewed anonymous counseling INSERT policy definition was not found';
  end if;

  select * into anon_select_policy
  from pg_policies
  where schemaname = 'public'
    and tablename = 'counseling_requests'
    and policyname = 'demo anon read counseling requests';

  if not found or anon_select_policy.cmd <> 'SELECT' then
    raise exception 'Reviewed anonymous counseling SELECT policy definition was not found';
  end if;

  if not has_table_privilege('anon', 'public.counseling_requests', 'INSERT')
     or not has_table_privilege('anon', 'public.counseling_requests', 'SELECT') then
    raise exception 'Expected anonymous counseling grants were not found';
  end if;
end
$$;

alter policy "users create counseling requests"
  on public.counseling_requests
  with check (
    exists (
      select 1
      from public.profiles p
      where p.id = counseling_requests.student_id
        and p.auth_user_id = (select auth.uid())
        and p.role = 'student'
    )
  );

alter policy "users read own counseling requests"
  on public.counseling_requests
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = counseling_requests.student_id
        and p.auth_user_id = (select auth.uid())
        and p.role = 'student'
    )
    or exists (
      select 1
      from public.professors p
      where p.id = counseling_requests.professor_id
        and p.profile_id = (select auth.uid())
    )
  );

drop policy "demo anon create counseling requests"
  on public.counseling_requests;
drop policy "demo anon read counseling requests"
  on public.counseling_requests;
revoke select, insert on public.counseling_requests from anon;

do $$
declare
  insert_policy record;
  select_policy record;
begin
  select * into insert_policy
  from pg_policies
  where schemaname = 'public'
    and tablename = 'counseling_requests'
    and policyname = 'users create counseling requests';

  select * into select_policy
  from pg_policies
  where schemaname = 'public'
    and tablename = 'counseling_requests'
    and policyname = 'users read own counseling requests';

  if insert_policy.cmd <> 'INSERT'
     or insert_policy.permissive <> 'PERMISSIVE'
     or insert_policy.roles <> array['authenticated']::name[]
     or position('p.id = counseling_requests.student_id' in insert_policy.with_check) = 0
     or position('p.auth_user_id = ( SELECT auth.uid() AS uid)' in insert_policy.with_check) = 0
     or position('p.role = ''student''' in insert_policy.with_check) = 0 then
    raise exception 'Counseling INSERT ownership policy postcondition failed';
  end if;

  if select_policy.cmd <> 'SELECT'
     or select_policy.permissive <> 'PERMISSIVE'
     or select_policy.roles <> array['authenticated']::name[]
     or position('p.id = counseling_requests.student_id' in select_policy.qual) = 0
     or position('p.auth_user_id = ( SELECT auth.uid() AS uid)' in select_policy.qual) = 0
     or position('p.role = ''student''' in select_policy.qual) = 0
     or position('p.profile_id = ( SELECT auth.uid() AS uid)' in select_policy.qual) = 0 then
    raise exception 'Counseling SELECT ownership policy postcondition failed';
  end if;

  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'counseling_requests'
      and policyname in (
        'demo anon create counseling requests',
        'demo anon read counseling requests'
      )
  )
     or has_table_privilege('anon', 'public.counseling_requests', 'INSERT')
     or has_table_privilege('anon', 'public.counseling_requests', 'SELECT') then
    raise exception 'Anonymous counseling INSERT/SELECT access was not removed';
  end if;

  if exists (
    (select * from _counseling_untouched_policy_baseline
     except
     select policyname, permissive, roles, cmd, qual, with_check
     from pg_policies
     where schemaname = 'public'
       and tablename = 'counseling_requests'
       and policyname not in (
         'users create counseling requests',
         'users read own counseling requests',
         'demo anon create counseling requests',
         'demo anon read counseling requests'
       ))
    union all
    (select policyname, permissive, roles, cmd, qual, with_check
     from pg_policies
     where schemaname = 'public'
       and tablename = 'counseling_requests'
       and policyname not in (
         'users create counseling requests',
         'users read own counseling requests',
         'demo anon create counseling requests',
         'demo anon read counseling requests'
       )
     except
     select * from _counseling_untouched_policy_baseline)
  ) then
    raise exception 'An unrelated counseling policy changed unexpectedly';
  end if;
end
$$;

commit;
