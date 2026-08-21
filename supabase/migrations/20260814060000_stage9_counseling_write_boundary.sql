-- Stage 9 (Codex review round) — counseling mutations belong to the server.
--
-- Stage 5 built a real workflow around counseling_requests: a legal-transition
-- matrix, a compare-and-set on the from-state so competing updates resolve to
-- exactly one winner, timing validation against the canonical slot engine, and
-- a notification to the affected student. Stage 9 then gave professors a direct
-- UPDATE policy authorized by OWNERSHIP alone — `professor_id = me` — which is a
-- different question from "is this a legal change".
--
-- MEASURED before this migration, as a signed-in professor of probe tenant A
-- PATCHing their own counseling row straight through PostgREST:
--
--   status pending -> approved        204, applied   (skips the CAS and the notification)
--   student_id -> tenant B's student  204, applied   (also a cross-tenant write)
--   suggested_start -> arbitrary      204, applied
--   requested_start -> arbitrary      400            (rejected by a constraint, not by policy)
--
-- THE DECISION. Every counseling UPDATE in the application already runs through
-- the service-role client after a server-side authorization check:
--
--   counseling.actions.ts:245   cancelMyCounselingRequest      (admin client)
--   professor.actions.ts:337    updateCounselingStatus         (admin client)
--   professor.actions.ts:425    updateCounselingDetails        (admin client)
--
-- So no ordinary client needs UPDATE at all, and the safest minimal
-- architecture applies: revoke it. The alternative — reproducing the Stage 5
-- transition matrix as a column-and-state RLS policy — would mean two
-- implementations of the same rule that can drift apart, which is exactly what
-- the review warned against.
--
-- DELETE goes too: nothing in the application deletes a counseling request
-- (cancellation is a status transition, by design since Stage 5).
--
-- INSERT and SELECT stay. The INSERT policy is tenant-clamped and is the DB
-- backstop for the student booking path, which does use the session client
-- (counseling.actions.ts:121). SELECT is how a participant reads their own row.
--
-- Preconditions: the tenant-clamped INSERT policy exists.
-- Postconditions: no client role holds UPDATE or DELETE; SELECT and INSERT
-- remain; the professor UPDATE policy is gone.
-- Rollback: re-grant update on public.counseling_requests to authenticated and
-- re-create the policy from 20260814010000. Do not, without replacing the
-- Stage 5 guarantees first.

begin;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'counseling_requests'
      and policyname = 'users create counseling requests'
  ) then
    raise exception 'precondition failed: the tenant-clamped INSERT policy is missing';
  end if;
end
$$;

drop policy if exists "professors update own counseling requests" on public.counseling_requests;

revoke update, delete on public.counseling_requests from authenticated;
revoke update, delete on public.counseling_requests from anon;

-- The server path is the only writer of transitions; make that explicit rather
-- than incidental.
grant select, insert on public.counseling_requests to authenticated;
grant select, insert, update, delete on public.counseling_requests to service_role;

do $$
declare
  offending text;
begin
  select string_agg(grantee || ':' || privilege_type, ', ')
    into offending
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name = 'counseling_requests'
    and grantee in ('anon', 'authenticated')
    and privilege_type in ('UPDATE', 'DELETE');
  if offending is not null then
    raise exception 'postcondition failed: a client role can still mutate counseling rows: %', offending;
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'counseling_requests'
      and cmd in ('UPDATE', 'DELETE')
  ) then
    raise exception 'postcondition failed: an UPDATE/DELETE policy survives on counseling_requests';
  end if;

  -- The legitimate paths must remain.
  if not has_table_privilege('authenticated', 'public.counseling_requests', 'select') then
    raise exception 'postcondition failed: authenticated lost SELECT on counseling_requests';
  end if;
  if not has_table_privilege('authenticated', 'public.counseling_requests', 'insert') then
    raise exception 'postcondition failed: authenticated lost INSERT on counseling_requests';
  end if;
  if not has_table_privilege('service_role', 'public.counseling_requests', 'update') then
    raise exception 'postcondition failed: service_role cannot perform the server-side transition';
  end if;
end
$$;

commit;
