-- Stage 9 (Codex round 4, finding 5) — anon holds no EXECUTE anywhere.
--
-- FOUND BY THE NEW SNAPSHOT GUARD, which is the point of it. Adding effective
-- `has_function_privilege` coverage to the security snapshot immediately turned
-- up two functions anon can still call:
--
--   public.replace_student_course_schedule_slots(uuid, jsonb)
--   public.replace_student_custom_course_schedule_slots(uuid, jsonb)
--
-- Both carry an EXPLICIT `anon=X` entry granted by 20260714150024, the demo-era
-- migration that created them. This is not the PostgreSQL default case — it is
-- a deliberate grant from the period when the whole application ran as anon.
--
-- WHY STAGE 9 MISSED IT. 20260814010000 closed the anon surface by revoking
-- TABLE privileges and dropping the `demo anon ...` policies, and its
-- postcondition asserted that anon holds no table privilege outside `schools`.
-- FUNCTION privileges were never in scope, so two RPC entry points survived a
-- migration whose stated purpose was to remove exactly this.
--
-- HOW BAD IS IT. Bounded, and stated honestly rather than dramatised: both are
-- SECURITY INVOKER, so RLS still applies with anon's own (now empty)
-- privileges, and a call would fail on the underlying tables. The defect is
-- that "anon cannot reach the data" rested on a second control rather than on
-- the entry point being closed. Defence in depth is the reason it was not
-- exploitable; it is not a reason to leave it.
--
-- The application calls both through an authenticated session
-- (student-timetable.service.ts, student-community.actions.ts), so removing
-- anon's EXECUTE changes no working path.
--
-- Preconditions: both functions exist.
-- Postconditions: anon holds EXECUTE on NO function in public or app_private,
-- computed with has_function_privilege so PUBLIC and inheritance are included;
-- authenticated retains EXECUTE on both.
-- Rollback: re-grant to anon — but the anon closure would be incomplete again.

begin;

do $$
declare
  rec record;
  revoked int := 0;
begin
  -- Revoke from every function anon can currently execute, rather than naming
  -- the two: if another survives, it must be caught too.
  for rec in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'app_private')
      and has_function_privilege('anon', p.oid, 'EXECUTE')
  loop
    execute format('revoke all on function %s from anon, public', rec.sig);
    revoked := revoked + 1;
  end loop;

  raise notice 'revoked anon EXECUTE on % function(s)', revoked;
end $$;

-- New functions must not arrive with anon EXECUTE either.
alter default privileges in schema public
  revoke execute on functions from anon;
alter default privileges in schema app_private
  revoke execute on functions from anon;

do $$
declare
  offenders text;
begin
  select string_agg(p.oid::regprocedure::text, ', ') into offenders
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'app_private')
    and has_function_privilege('anon', p.oid, 'EXECUTE');

  if offenders is not null then
    raise exception 'postcondition failed: anon can still EXECUTE: %', offenders;
  end if;

  -- The legitimate callers must survive. Revoking from PUBLIC above could have
  -- taken authenticated's access with it if it had relied on the PUBLIC grant.
  if not has_function_privilege(
       'authenticated',
       'public.replace_student_course_schedule_slots(uuid, jsonb)',
       'EXECUTE')
     or not has_function_privilege(
       'authenticated',
       'public.replace_student_custom_course_schedule_slots(uuid, jsonb)',
       'EXECUTE') then
    raise exception 'postcondition failed: authenticated lost EXECUTE on a timetable RPC it uses';
  end if;

  if not has_function_privilege('authenticated', 'app_private.current_profile_id()', 'EXECUTE') then
    raise exception 'postcondition failed: authenticated cannot call the identity helper; every policy would deny';
  end if;
end $$;

commit;
