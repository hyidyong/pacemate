-- Stage 9 (Codex round 5, F9) — PROOF that the future-function control works.
--
-- Separate from 20260814220000 for two reasons, both learned the hard way:
--
--   1. An event trigger created inside a transaction does not fire for DDL
--      executed later in that same transaction. Verifying beside the
--      installation would always fail, and "always fails" is indistinguishable
--      from "the control is broken".
--   2. The probe functions must be created by TOP-LEVEL statements. DDL run
--      inside a `DO $$ … $$` body did not fire the trigger here, so a
--      verification written that way reported a PUBLIC grant that a real
--      `CREATE FUNCTION` does not get. That would have been a false alarm
--      about a working control — the mirror image of a false pass, and just as
--      misleading.
--
-- So: create at the top level, assert in a DO block that only READS, drop at
-- the top level. Catalog state is evidence about intent; this is evidence about
-- behaviour, which is what F9 asked for.
--
-- Preconditions: the event trigger exists and is enabled.
-- Postconditions: a NEW function is not executable by anon and carries no
-- PUBLIC (=X) grant, in both `public` and `app_private`; `authenticated` and
-- `service_role` still can, because every server RPC depends on it.
-- Rollback: none needed; this migration only asserts.

begin;

do $$
begin
  if not exists (
    select 1 from pg_event_trigger
    where evtname = 'revoke_public_function_execute_trg' and evtenabled <> 'D'
  ) then
    raise exception 'precondition failed: the future-function event trigger is missing or disabled';
  end if;
end $$;

create function public.__acl_probe_public() returns int language sql as 'select 1';
create function app_private.__acl_probe_private() returns int language sql as 'select 1';

do $$
declare
  anon_public boolean;
  anon_private boolean;
  public_grant boolean;
  authd_public boolean;
  svc_public boolean;
  observed text;
begin
  select coalesce(proacl::text, '(null)') into observed
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = '__acl_probe_public';

  anon_public  := has_function_privilege('anon', 'public.__acl_probe_public()', 'EXECUTE');
  anon_private := has_function_privilege('anon', 'app_private.__acl_probe_private()', 'EXECUTE');
  -- A PUBLIC entry has an EMPTY grantee: the ACL item begins with '=' right
  -- after '{' or a comma. Matching '%=X/%' instead is wrong — it also matches
  -- 'postgres=X/postgres', which is the OWNER's own grant, and would report a
  -- PUBLIC grant on a function that has none.
  public_grant := observed ~ '(^\{|,)=';
  authd_public := has_function_privilege('authenticated', 'public.__acl_probe_public()', 'EXECUTE');
  svc_public   := has_function_privilege('service_role', 'public.__acl_probe_public()', 'EXECUTE');

  if anon_public then
    raise exception 'postcondition failed: a NEW function in public is executable by anon (acl %)', observed;
  end if;
  if anon_private then
    raise exception 'postcondition failed: a NEW function in app_private is executable by anon';
  end if;
  if public_grant then
    raise exception 'postcondition failed: a NEW function still carries a PUBLIC (=X) grant (acl %)', observed;
  end if;

  -- The other direction, because a sweep that also breaks every server RPC is
  -- not a fix and this is the cheapest place to notice.
  if not authd_public then
    raise exception 'postcondition failed: authenticated cannot execute a new function; RPCs would break';
  end if;
  if not svc_public then
    raise exception 'postcondition failed: service_role cannot execute a new function; server RPCs would break';
  end if;

  raise notice 'future-function ACL verified: %', observed;
end $$;

drop function public.__acl_probe_public();
drop function app_private.__acl_probe_private();

commit;
