-- Stage 9 (Codex round 5, F1) — Stage 5's booking invariants are not bypassable
-- through the Data API.
--
-- THE DEFECT. `authenticated` held table INSERT on `counseling_requests`, and
-- the INSERT policy could only check two things:
--
--   * `student_id` is the caller's own profile, and the caller is a student;
--   * `professor_id` belongs to a professor in the caller's school.
--
-- Everything Stage 5 actually enforces lived in `createCounselingRequest()`:
-- the slot must be one of `getAvailableCounselingSlots(tenant)` — which is what
-- makes it canonical, inside the professor's availability, of that professor's
-- slot length, and within the booking horizon — and `status` is a server
-- constant, never caller input. A student who skipped the action and POSTed
-- straight to PostgREST got none of it.
--
-- MEASURED LIVE, all five persisted with HTTP 201:
--
--   booking:non-slot-time        10:07–10:37, not a slot boundary
--   booking:excessive-duration   an eight-hour "counseling session"
--   booking:outside-availability 03:00, when the professor is not available
--   booking:far-horizon          900 days into the future
--   booking:self-approved        status = 'approved', self-granted
--
-- A note on how that was measured, because the first attempt got it wrong. An
-- earlier draft of the probe reused one base time for every attempt, and
-- `counseling_requests_no_active_overlap` (an EXCLUDE constraint) rejected two
-- of them — because they collided with a row a PREVIOUS attempt in the same
-- loop had just created. Those two read as 400/"protected" when nothing had
-- authorized anything. Giving each attempt a disjoint day showed all five
-- succeeding. A denial produced by an unrelated constraint is not an
-- authorization control.
--
-- WHY THE GRANT GOES INSTEAD OF THE POLICY GROWING. The invariants above are
-- not expressible as an RLS predicate without reimplementing the slot engine in
-- SQL — availability windows, slot length arithmetic, the horizon — and then
-- keeping that copy in step with the TypeScript one forever. Two definitions of
-- "a valid slot" is a worse failure mode than the one being fixed. The
-- application already has an authoritative transaction boundary, so the write
-- moves behind it: `createCounselingRequest()` now performs its INSERT under
-- the service role AFTER its existing validation.
--
-- WHAT DOES NOT CHANGE. Reads still go through the caller's session, so RLS
-- still decides what a student may see. The EXCLUDE constraint still arbitrates
-- concurrent bookings — the service role does not bypass constraints — so
-- Stage 5's conflict detection, stale-slot handling and duplicate
-- acknowledgement are untouched. Cancellation already ran under the service
-- role as a compare-and-set (D-014).
--
-- Preconditions: counseling_requests exists and has an INSERT policy.
-- Postconditions: no client role holds INSERT; service_role does; SELECT for
-- authenticated survives; the overlap constraint is still present.
-- Rollback: re-grant INSERT — and the five bypasses above return.

begin;

do $$
begin
  if to_regclass('public.counseling_requests') is null then
    raise exception 'precondition failed: public.counseling_requests is missing';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.counseling_requests'::regclass
      and conname = 'counseling_requests_no_active_overlap'
  ) then
    raise exception 'precondition failed: the booking overlap constraint is missing; concurrency would be unguarded';
  end if;
end $$;

revoke insert on public.counseling_requests from anon, authenticated;

-- The policy is now unreachable for every client role. Dropping it rather than
-- leaving it in place: a policy that cannot fire is drift, and a future reader
-- would reasonably assume it was still the boundary.
drop policy if exists "users create counseling requests" on public.counseling_requests;

do $$
declare
  offenders text;
begin
  select string_agg(r.rolname, ', ') into offenders
  from (values ('anon'), ('authenticated')) as r(rolname)
  where has_table_privilege(r.rolname, 'public.counseling_requests', 'INSERT');
  if offenders is not null then
    raise exception 'postcondition failed: % can still INSERT counseling requests', offenders;
  end if;

  if not has_table_privilege('service_role', 'public.counseling_requests', 'INSERT') then
    raise exception 'postcondition failed: service_role cannot INSERT; the booking action would break';
  end if;

  -- The legitimate read path must survive.
  if not has_table_privilege('authenticated', 'public.counseling_requests', 'SELECT') then
    raise exception 'postcondition failed: authenticated lost SELECT; students could not see their bookings';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'counseling_requests' and cmd = 'SELECT'
  ) then
    raise exception 'postcondition failed: the participant SELECT policy disappeared';
  end if;
end $$;

commit;
