-- Stage 9 (Codex round 3, F7) — make the ACL match the append-only claim.
--
-- The previous round added a BEFORE UPDATE trigger and said the audit trail was
-- append-only. The privileges did not agree. Read from the live snapshot:
--
--   security_events  service_role  DELETE, INSERT, REFERENCES, SELECT,
--                                  TRIGGER, TRUNCATE, UPDATE
--
-- `grant select, insert, delete` was issued, but the platform's default grants
-- were never revoked first, so UPDATE and TRUNCATE survived. TRUNCATE is the
-- serious one: it does not fire row triggers, so the append-only trigger could
-- be bypassed entirely and the whole trail removed in one statement. UPDATE was
-- caught by the trigger, but relying on a trigger to compensate for a privilege
-- that should not exist is the wrong shape.
--
-- REVOKE FIRST, THEN GRANT AN EXACT ALLOWLIST. service_role keeps INSERT (the
-- application writes the trail) and SELECT (operators read it). Nothing else,
-- for anyone.
--
-- THE PROBE-CLEANUP CONFLICT, resolved the way the review asked. The audit probe
-- previously deleted its own rows, which is why DELETE was granted. Production
-- append-only behaviour is not weakened for testing convenience: the probe now
-- writes clearly marked test events and ACCEPTS that they remain in the trail
-- permanently, which is what "append-only" means. They are reported, never
-- silently ignored, and they carry no personal data.
--
-- STILL NOT CLAIMED: tamper-proofing. There is no hash chain and no signature. A
-- compromised service-role key can still APPEND false rows, and anyone with
-- direct database (not API) access as an owner can do anything. What is now true
-- is that no role reachable through the API can alter or remove a record.
--
-- Also reduces `schools` to an exact allowlist: service_role held
-- REFERENCES/TRIGGER/TRUNCATE there too, none of which it needs.
--
-- Preconditions: security_events exists with its append-only trigger.
-- Postconditions: no role holds UPDATE, DELETE or TRUNCATE on security_events;
-- service_role retains INSERT and SELECT; authenticated retains SELECT.
-- Rollback: re-grant, but the append-only claim would then be false again.

begin;

do $$
begin
  if to_regclass('public.security_events') is null then
    raise exception 'precondition failed: security_events is missing';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.security_events'::regclass
      and tgname = 'security_events_no_update_trg'
      and not tgisinternal
  ) then
    raise exception 'precondition failed: the append-only trigger is missing';
  end if;
end
$$;

revoke all on public.security_events from public, anon, authenticated, service_role;
grant select on public.security_events to authenticated;   -- RLS narrows to tenant admins
grant insert, select on public.security_events to service_role;

revoke all on public.schools from service_role;
grant select, insert, update, delete on public.schools to service_role;

do $$
declare
  offending text;
begin
  -- Nothing may mutate or remove an audit record through the API.
  select string_agg(grantee || ':' || privilege_type, ', ' order by grantee, privilege_type)
    into offending
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name = 'security_events'
    and privilege_type in ('UPDATE', 'DELETE', 'TRUNCATE')
    and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC');
  if offending is not null then
    raise exception 'postcondition failed: the audit trail is still mutable: %', offending;
  end if;

  -- The writer and the reader must still work.
  if not has_table_privilege('service_role', 'public.security_events', 'insert') then
    raise exception 'postcondition failed: service_role cannot append to the audit trail';
  end if;
  if not has_table_privilege('service_role', 'public.security_events', 'select') then
    raise exception 'postcondition failed: service_role cannot read the audit trail';
  end if;
  if not has_table_privilege('authenticated', 'public.security_events', 'select') then
    raise exception 'postcondition failed: tenant admins cannot read the audit trail';
  end if;

  -- schools: exact allowlist, no TRUNCATE anywhere.
  select string_agg(grantee || ':' || privilege_type, ', ' order by grantee, privilege_type)
    into offending
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name = 'schools'
    and privilege_type in ('TRUNCATE', 'TRIGGER', 'REFERENCES')
    and grantee in ('anon', 'authenticated', 'service_role');
  if offending is not null then
    raise exception 'postcondition failed: schools is still over-granted: %', offending;
  end if;
  if not has_table_privilege('service_role', 'public.schools', 'delete') then
    raise exception 'postcondition failed: service_role can no longer remove a disposable probe tenant';
  end if;
end
$$;

commit;
