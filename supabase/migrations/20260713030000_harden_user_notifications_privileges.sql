begin;

-- Demo-cookie-only users operate as the anon database role. Keep the existing
-- read/create/update surface intact while removing unrelated table privileges.

do $$
declare
  table_exists boolean;
  rls_enabled boolean;
  required_policy text;
begin
  select to_regclass('public.user_notifications') is not null
    into table_exists;

  if not table_exists then
    raise exception 'Expected public.user_notifications table is missing';
  end if;

  select c.relrowsecurity
    into rls_enabled
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'user_notifications';

  if not coalesce(rls_enabled, false) then
    raise exception 'RLS must be enabled on public.user_notifications';
  end if;

  foreach required_policy in array array[
    'demo read notifications',
    'demo create notifications',
    'demo update notifications'
  ] loop
    if not exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = 'user_notifications'
        and policyname = required_policy
    ) then
      raise exception 'Required notification policy is missing: %', required_policy;
    end if;
  end loop;
end
$$;

-- Keep an exact in-transaction snapshot so the three existing demo policies
-- are proven unchanged after the privilege change.
create temporary table _user_notifications_policy_baseline
on commit drop
as
select
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename = 'user_notifications'
  and policyname in (
    'demo read notifications',
    'demo create notifications',
    'demo update notifications'
  );

do $$
declare
  baseline_policy_count integer;
  role_name name;
  privilege_name text;
begin
  select count(*)
    into baseline_policy_count
  from _user_notifications_policy_baseline;

  if baseline_policy_count <> 3 then
    raise exception 'Expected exactly three notification demo policies before changes';
  end if;

  -- Fail closed if the compatibility grants are not in the expected state.
  foreach role_name in array array['anon', 'authenticated']::name[] loop
    foreach privilege_name in array array[
      'SELECT',
      'INSERT',
      'UPDATE',
      'DELETE',
      'TRUNCATE',
      'REFERENCES',
      'TRIGGER'
    ] loop
      if not has_table_privilege(
        role_name,
        'public.user_notifications',
        privilege_name
      ) then
        raise exception
          'Unexpected privilege state for role % on user_notifications: % is missing',
          role_name,
          privilege_name;
      end if;
    end loop;
  end loop;
end
$$;

-- SELECT/INSERT/UPDATE are intentionally not tightened in this migration.
-- Ownership RLS hardening will be handled after notification creation paths
-- and demo Auth compatibility are migrated.
revoke delete, truncate, references, trigger
on table public.user_notifications
from anon, authenticated;

do $$
declare
  rls_enabled boolean;
  role_name name;
  privilege_name text;
begin
  select c.relrowsecurity
    into rls_enabled
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'user_notifications';

  if not coalesce(rls_enabled, false) then
    raise exception 'RLS was disabled on public.user_notifications';
  end if;

  foreach role_name in array array['anon', 'authenticated']::name[] loop
    foreach privilege_name in array array[
      'DELETE',
      'TRUNCATE',
      'REFERENCES',
      'TRIGGER'
    ] loop
      if has_table_privilege(
        role_name,
        'public.user_notifications',
        privilege_name
      ) then
        raise exception
          'Privilege was not revoked for role % on user_notifications: % remains',
          role_name,
          privilege_name;
      end if;
    end loop;

    foreach privilege_name in array array['SELECT', 'INSERT', 'UPDATE'] loop
      if not has_table_privilege(
        role_name,
        'public.user_notifications',
        privilege_name
      ) then
        raise exception
          'Compatibility privilege changed for role % on user_notifications: % is missing',
          role_name,
          privilege_name;
      end if;
    end loop;
  end loop;

  if exists (
    select 1
    from _user_notifications_policy_baseline baseline
    left join pg_policies current_policy
      on current_policy.schemaname = 'public'
     and current_policy.tablename = 'user_notifications'
     and current_policy.policyname = baseline.policyname
    where current_policy.policyname is null
       or current_policy.permissive is distinct from baseline.permissive
       or current_policy.roles is distinct from baseline.roles
       or current_policy.cmd is distinct from baseline.cmd
       or current_policy.qual is distinct from baseline.qual
       or current_policy.with_check is distinct from baseline.with_check
  ) then
    raise exception 'An existing notification demo policy changed unexpectedly';
  end if;

  if exists (
    select 1
    from pg_policies current_policy
    where current_policy.schemaname = 'public'
      and current_policy.tablename = 'user_notifications'
      and current_policy.policyname in (
        'demo read notifications',
        'demo create notifications',
        'demo update notifications'
      )
      and not exists (
        select 1
        from _user_notifications_policy_baseline baseline
        where baseline.policyname = current_policy.policyname
      )
  ) then
    raise exception 'An unexpected notification demo policy exists';
  end if;
end
$$;

commit;
