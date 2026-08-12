-- Stage 9 (Codex review round) — F7 explicit ACLs, F8 durable audit semantics.
--
-- F7. `security_events` and `approve_course_weekly_plan` relied on INCIDENTAL
-- privileges. Live inspection: service_role holds INSERT/SELECT/UPDATE/DELETE on
-- the audit table and EXECUTE on the RPC, but no migration grants any of that —
-- it comes from Supabase's default grants for the `public` schema. A rebuild in
-- a project configured differently would produce an application that cannot
-- write its own audit trail, and nothing would notice until an incident. Intent
-- must be stated, and verified in BOTH directions: the privileges we need are
-- present, and the ones we forbid are absent.
--
-- F8. Attribution could be erased. `actor_profile_id` and `school_id` are
-- ON DELETE SET NULL, so deleting a profile or a school silently blanks the
-- actor and tenant of every historical event that referenced it — exactly the
-- rows an investigation needs after an account is removed. A nullable FK is a
-- convenience pointer, not a historical record.
--
-- The fix is a snapshot: immutable text copies of the identifiers, written at
-- event time and never touched by a cascade. The FKs stay for joinability while
-- the referenced row exists; the snapshots are the evidence. They hold opaque
-- UUIDs and a role name — no names, no emails, nothing that widens the PII
-- surface.
--
-- Audit rows also become append-only in the strict sense: a BEFORE UPDATE
-- trigger rejects every update, including by the service role. Nothing in the
-- application updates an audit row, and "append-oriented" should mean the
-- database enforces it rather than the code remembering to.
--
-- DELETE is deliberately left to service_role: retention pruning is a
-- foreseeable operational need and there is no retention policy yet to encode.
-- That is a documented gap, not an oversight — a compromised service-role key
-- can still delete history. No tamper-proofing is claimed.
--
-- Preconditions: the audit table exists.
-- Postconditions: snapshots present; UPDATE rejected; required grants present;
-- forbidden grants absent.
-- Rollback: drop the trigger and the snapshot columns; re-run 20260814030000.

begin;

do $$
begin
  if to_regclass('public.security_events') is null then
    raise exception 'precondition failed: run 20260814030000_stage9_security_events first';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- F8.1 Immutable attribution snapshots.
-- ---------------------------------------------------------------------------
alter table public.security_events
  add column if not exists actor_ref text,
  add column if not exists school_ref text,
  add column if not exists actor_role_ref text;

-- Backfill from the live FKs while they still resolve.
update public.security_events
   set actor_ref = coalesce(actor_ref, actor_profile_id::text),
       school_ref = coalesce(school_ref, school_id::text),
       actor_role_ref = coalesce(actor_role_ref, actor_role::text)
 where actor_ref is null or school_ref is null or actor_role_ref is null;

comment on column public.security_events.actor_ref is
  'Immutable snapshot of actor_profile_id at event time. Survives profile deletion; actor_profile_id does not (ON DELETE SET NULL).';
comment on column public.security_events.school_ref is
  'Immutable snapshot of school_id at event time. Survives tenant deletion.';
comment on column public.security_events.actor_role_ref is
  'Immutable snapshot of the actor role at event time, independent of any later role change.';

-- Keep the snapshot honest even if a caller forgets to pass it: derive it from
-- the FK columns on insert. A trigger is the only place this cannot be skipped.
create or replace function app_private.security_events_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.actor_ref := coalesce(new.actor_ref, new.actor_profile_id::text);
  new.school_ref := coalesce(new.school_ref, new.school_id::text);
  new.actor_role_ref := coalesce(new.actor_role_ref, new.actor_role::text);
  return new;
end
$$;

drop trigger if exists security_events_snapshot_trg on public.security_events;
create trigger security_events_snapshot_trg
  before insert on public.security_events
  for each row execute function app_private.security_events_snapshot();

-- ---------------------------------------------------------------------------
-- F8.2 Append-only in the strict sense: no UPDATE, by anyone.
-- ---------------------------------------------------------------------------
create or replace function app_private.security_events_reject_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'security_events is append-only; updating an audit record is not permitted';
end
$$;

drop trigger if exists security_events_no_update_trg on public.security_events;
create trigger security_events_no_update_trg
  before update on public.security_events
  for each row execute function app_private.security_events_reject_update();

create index if not exists security_events_actor_ref_idx
  on public.security_events (actor_ref, occurred_at desc);

-- ---------------------------------------------------------------------------
-- F7 Explicit ACLs. Nothing below relies on a default grant.
-- ---------------------------------------------------------------------------
revoke all on public.security_events from public, anon, authenticated;
grant select on public.security_events to authenticated;   -- RLS narrows this to tenant admins
grant select, insert, delete on public.security_events to service_role;
-- UPDATE is intentionally NOT granted to anyone; the trigger above is the
-- backstop for a role that has it by some other route.

revoke all on function public.approve_course_weekly_plan(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.approve_course_weekly_plan(uuid, uuid, jsonb) to service_role;

revoke all on function app_private.security_events_snapshot() from public, anon, authenticated;
revoke all on function app_private.security_events_reject_update() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Postconditions — positive AND negative.
-- ---------------------------------------------------------------------------
do $$
declare
  offending text;
begin
  -- Required access is present.
  if not has_table_privilege('service_role', 'public.security_events', 'insert') then
    raise exception 'postcondition failed: service_role cannot write the audit trail';
  end if;
  if not has_table_privilege('service_role', 'public.security_events', 'select') then
    raise exception 'postcondition failed: service_role cannot read the audit trail';
  end if;
  if not has_table_privilege('authenticated', 'public.security_events', 'select') then
    raise exception 'postcondition failed: tenant admins cannot read the audit trail';
  end if;
  if not has_function_privilege('service_role', 'public.approve_course_weekly_plan(uuid, uuid, jsonb)', 'execute') then
    raise exception 'postcondition failed: service_role cannot execute the approval RPC';
  end if;

  -- Forbidden access is absent.
  select string_agg(grantee || ':' || privilege_type, ', ')
    into offending
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name = 'security_events'
    and (
      (grantee in ('anon', 'authenticated', 'PUBLIC') and privilege_type <> 'SELECT')
      or (grantee = 'anon')
    );
  if offending is not null then
    raise exception 'postcondition failed: forbidden audit privileges: %', offending;
  end if;

  if has_table_privilege('authenticated', 'public.security_events', 'update')
     or has_table_privilege('authenticated', 'public.security_events', 'delete')
     or has_table_privilege('authenticated', 'public.security_events', 'insert') then
    raise exception 'postcondition failed: an ordinary user can mutate the audit trail';
  end if;

  if has_function_privilege('anon', 'public.approve_course_weekly_plan(uuid, uuid, jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.approve_course_weekly_plan(uuid, uuid, jsonb)', 'execute') then
    raise exception 'postcondition failed: a client role can execute the approval RPC';
  end if;

  -- Snapshots exist.
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'security_events'
      and column_name in ('actor_ref', 'school_ref', 'actor_role_ref')
    having count(*) = 3
  ) then
    raise exception 'postcondition failed: attribution snapshot columns are missing';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.security_events'::regclass
      and tgname = 'security_events_no_update_trg'
      and not tgisinternal
  ) then
    raise exception 'postcondition failed: the append-only trigger is missing';
  end if;
end
$$;

commit;
