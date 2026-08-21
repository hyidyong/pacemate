-- Stage 9 (Codex review round, F8 follow-up) — an audit record references
-- nothing it can be damaged by.
--
-- 20260814080000 added immutable attribution snapshots and made the audit table
-- append-only with a BEFORE UPDATE trigger. Verifying it surfaced a real
-- interaction between the two: `actor_profile_id` and `school_id` were
-- ON DELETE SET NULL, and a cascade IS an UPDATE, so the append-only trigger
-- refused it and DELETING A PROFILE FAILED OUTRIGHT once any audit row
-- referenced it:
--
--   ERROR: security_events is append-only; updating an audit record is not permitted
--   CONTEXT: SQL statement "UPDATE ONLY security_events SET actor_profile_id = NULL ..."
--            SQL statement "delete from public.profiles where id = ..."
--
-- That is worse than the original defect: the audit trail would have quietly
-- become a lock on user deletion, which matters directly for the erasure path
-- this project still owes (KI-022).
--
-- The resolution follows the review's own guidance — do not rely on foreign keys
-- whose deletion semantics destroy or constrain historical meaning. The columns
-- stay (they are useful for joining while the referenced row exists) but the
-- CONSTRAINTS go. An audit record then has no referential relationship that can
-- null it, block a delete, or cascade it away; the immutable snapshots remain
-- the evidence, and `actor_role_ref` additionally records the role AS IT WAS,
-- which no live join can reconstruct after a role change.
--
-- Preconditions: the snapshot columns and the append-only trigger exist.
-- Postconditions: no FK remains on the audit table; a profile carrying audit
-- history can be deleted; the snapshot survives that deletion.
-- Rollback: re-add the constraints — but the delete-blocking behaviour returns.

begin;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'security_events' and column_name = 'actor_ref'
  ) then
    raise exception 'precondition failed: run 20260814080000 first';
  end if;
end
$$;

alter table public.security_events
  drop constraint if exists security_events_actor_profile_id_fkey,
  drop constraint if exists security_events_school_id_fkey;

comment on column public.security_events.actor_profile_id is
  'Convenience pointer only — deliberately NOT a foreign key. An audit record must not be nullable, blockable or cascadable by the lifecycle of the row it describes. actor_ref is the durable evidence.';
comment on column public.security_events.school_id is
  'Convenience pointer only — deliberately NOT a foreign key. See actor_profile_id.';

do $$
declare
  remaining text;
  v_school uuid;
  v_profile uuid;
  v_event uuid;
  v_actor uuid;
  v_ref text;
begin
  select string_agg(conname, ', ')
    into remaining
  from pg_constraint
  where conrelid = 'public.security_events'::regclass and contype = 'f';
  if remaining is not null then
    raise exception 'postcondition failed: foreign keys survive on the audit table: %', remaining;
  end if;

  -- Prove the property rather than assert it: create a disposable profile, an
  -- audit row about it, delete the profile, and confirm the record is intact
  -- AND that the deletion succeeded.
  select id into v_school from public.schools limit 1;
  insert into public.profiles (identifier, name, role, school_id)
  values ('stage9-audit-selftest@migration.invalid', 'stage9 audit selftest', 'student', v_school)
  returning id into v_profile;

  insert into public.security_events (event, outcome, actor_profile_id, school_id, actor_role, detail)
  values ('stage9.audit_selftest', 'ok', v_profile, v_school, 'student', 'selftest')
  returning id into v_event;

  delete from public.profiles where id = v_profile;

  select actor_profile_id, actor_ref into v_actor, v_ref
  from public.security_events where id = v_event;

  if v_ref is distinct from v_profile::text then
    raise exception 'postcondition failed: the attribution snapshot did not survive actor deletion';
  end if;
  if v_actor is distinct from v_profile then
    raise exception 'postcondition failed: the audit row was mutated by the actor deletion';
  end if;

  delete from public.security_events where id = v_event;

  if exists (select 1 from public.profiles where identifier = 'stage9-audit-selftest@migration.invalid') then
    raise exception 'postcondition failed: the self-test profile was not removed';
  end if;
end
$$;

commit;
