-- Stage 9 (Codex round 5, F9) — a function created TOMORROW must not be
-- executable by PUBLIC or anon.
--
-- WHAT ROUND 4 GOT WRONG. 20260814190000 revoked anon's EXECUTE on every
-- function that existed and added
-- `alter default privileges ... revoke execute on functions from anon`.
-- F9 said that leaves PUBLIC's default EXECUTE intact, and the database agrees.
-- Measured by creating a throwaway function and reading its ACL:
--
--   {=X/postgres, postgres=X/postgres, authenticated=X/postgres, service_role=X/postgres}
--    ^^^^^^^^^^^ the empty grantee IS PUBLIC
--
-- anon's access never came from an anon grant, so revoking from anon removed
-- nothing. Both schemas were affected: `public` and `app_private` alike handed
-- a brand-new function to anon.
--
-- WHY DEFAULT PRIVILEGES ALONE DO NOT FIX IT. `ALTER DEFAULT PRIVILEGES` is
-- keyed on the role that CREATES the object. This database has more than one
-- such role (`pg_default_acl` holds separate rows for `postgres` and
-- `supabase_admin`), and the migration connection is not a member of all of
-- them. Setting the default for one role leaves every other creation path
-- untouched — which is exactly the failure being fixed, one level up. Measured:
-- after setting the postgres default correctly, a newly created function STILL
-- carried `=X/postgres`.
--
-- SO THE INVARIANT IS ENFORCED, NOT CONFIGURED. An event trigger runs after
-- every CREATE/ALTER FUNCTION in the two schemas this repository owns and
-- revokes EXECUTE from PUBLIC and anon. It does not care which role created the
-- function or what that role's defaults are, which is the whole point.
--
-- It fires on DDL only, so an explicit `grant execute ... to anon` afterwards
-- still works — the trigger sets the floor, it does not forbid a deliberate,
-- reviewable exception. `authenticated` and `service_role` are never touched:
-- every SECURITY DEFINER RPC in the app is called through them, and a
-- least-privilege pass that broke those would not be a fix.
--
-- Default privileges are still set where we can, as defence in depth.
--
-- Preconditions: app_private exists.
-- Postconditions: EMPIRICAL — a throwaway function is created in each schema
-- and the database is asked who may execute it. anon and PUBLIC must not;
-- authenticated and service_role must. Probes are dropped either way.
-- Rollback: drop the event trigger, and new functions become anon-callable.

begin;

do $$
begin
  if to_regnamespace('app_private') is null then
    raise exception 'precondition failed: schema app_private is missing';
  end if;
end $$;

-- Belt: defaults for every creating role we are actually a member of.
do $$
declare
  owner_role text;
  target_schema text;
begin
  foreach owner_role in array array['postgres', 'supabase_admin', current_user]
  loop
    if not pg_has_role(current_user, owner_role, 'USAGE') then
      raise notice 'skipping default privileges for %, not a member', owner_role;
      continue;
    end if;
    foreach target_schema in array array['public', 'app_private']
    loop
      execute format(
        'alter default privileges for role %I in schema %I revoke execute on functions from public, anon',
        owner_role, target_schema
      );
    end loop;
  end loop;
end $$;

-- Braces: the control that actually holds, whoever creates the function.
create or replace function app_private.revoke_public_function_execute()
returns event_trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  obj record;
begin
  for obj in select * from pg_event_trigger_ddl_commands()
  loop
    -- Only the two schemas this repository owns. Extensions, storage, graphql
    -- and the rest of the platform's schemas are not ours to re-privilege.
    if obj.command_tag in ('CREATE FUNCTION', 'ALTER FUNCTION')
       and obj.schema_name in ('public', 'app_private') then
      execute format('revoke execute on function %s from public, anon', obj.object_identity);
    end if;
  end loop;
end;
$fn$;

drop event trigger if exists revoke_public_function_execute_trg;
create event trigger revoke_public_function_execute_trg
  on ddl_command_end
  when tag in ('CREATE FUNCTION', 'ALTER FUNCTION')
  execute function app_private.revoke_public_function_execute();

-- The empirical proof lives in the NEXT migration, deliberately.
--
-- An event trigger created inside a transaction does not fire for DDL executed
-- later in that SAME transaction — the trigger set is resolved when the
-- statement begins. Verifying here would therefore always fail, and "always
-- fails" is indistinguishable from "the control does not work". 20260814230000
-- runs in its own transaction, where the trigger is live, and proves the
-- behaviour by creating a throwaway function and asking the database.

do $$
begin
  if not exists (select 1 from pg_event_trigger where evtname = 'revoke_public_function_execute_trg') then
    raise exception 'postcondition failed: the event trigger was not installed';
  end if;
  if not exists (
    select 1 from pg_event_trigger
    where evtname = 'revoke_public_function_execute_trg' and evtenabled <> 'D'
  ) then
    raise exception 'postcondition failed: the event trigger is installed but DISABLED';
  end if;
end $$;

commit;
