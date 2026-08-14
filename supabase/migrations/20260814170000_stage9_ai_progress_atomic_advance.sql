-- Stage 9 (Codex round 4, finding 3) — the weekly advance is ONE atomic
-- transition against ONE exact enrollment.
--
-- THREE DEFECTS, all confirmed against the code and the live schema.
--
-- 1. THE AUTHORIZED ROW'S IDENTITY WAS DISCARDED.
--    `authorizeCourseForStudent()` selected `course_id, current_week` and
--    returned only the week. The primary key of the row it had just authorized
--    was thrown away, so nothing downstream could name it.
--
-- 2. THE CAS WAS A BROAD PREDICATE.
--    Because the id was gone, the update matched on
--    `student_id + course_id + current_week`. `student_courses` is
--    UNIQUE (student_id, course_id, STATUS) — status is part of the key — so
--    several rows per (student, course) are representable, and the application
--    writes at least two statuses ("interested" and "completed"). Every row
--    matching that predicate advanced. Authorization inspected one row and the
--    write moved all of them. (`.limit(1).maybeSingle()` with no ORDER BY also
--    made "which one" arbitrary.)
--
-- 3. FEEDBACK WAS WRITTEN BEFORE THE CALLER HAD WON.
--    The progress upsert ran first, then the CAS. A caller that lost the race
--    had already persisted, so a loser mutated state — and there was no
--    transaction to roll it back, because the two statements were separate
--    PostgREST round trips.
--
-- WHY AN RPC. 3 cannot be fixed by reordering alone. Doing the CAS first and
-- the feedback second removes the losing write, but if the feedback insert then
-- fails the enrollment has advanced with nothing recorded — a half-transition
-- that no retry can repair, because the expected week no longer matches. Two
-- PostgREST calls cannot be made atomic from the client. One function can.
-- This codebase already uses SECURITY DEFINER RPCs for exactly this shape
-- (approve_course_weekly_plan, answer_professor_questions), so it is the
-- established pattern rather than a new mechanism.
--
-- WHAT MAKES IT CORRECT. `select ... for update of sc` takes a row lock while
-- the predicate still includes `sc.current_week = p_expected_week`. A second
-- caller blocks on that lock; when the first commits, READ COMMITTED
-- re-evaluates the predicate against the new row version, the week no longer
-- matches, and the second caller finds nothing and returns 'stale'. Exactly one
-- winner, enforced by the database rather than by a hope about interleaving.
--
-- THE ENROLLMENT ID IS UNTRUSTED. It arrives from the caller, so the function
-- re-derives the actor with app_private.current_profile_id() and re-checks both
-- ownership and tenancy. The caller cannot name someone else's enrollment, and
-- cannot name one in another university.
--
-- FINAL WEEK. Reaching the last week still records feedback and does not
-- advance — the pre-existing behaviour, preserved deliberately. It returns
-- 'final_week' so the caller can tell that apart from winning.
--
-- Preconditions: student_courses, student_mission_progress and the identity
-- helpers exist; student_mission_progress is unique on
-- (student_id, course_id, week_number) so the upsert has a conflict target.
-- Postconditions: the function exists, is SECURITY DEFINER with a pinned
-- search_path, and is executable by `authenticated` but NOT by `anon`.
-- Rollback: drop the function — but the client would have to go back to two
-- non-atomic round trips.

begin;

do $$
begin
  if to_regclass('public.student_courses') is null
     or to_regclass('public.student_mission_progress') is null then
    raise exception 'precondition failed: enrollment or progress table is missing';
  end if;
  if to_regproc('app_private.current_profile_id') is null
     or to_regproc('app_private.current_school_id') is null then
    raise exception 'precondition failed: identity helpers are missing';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.student_mission_progress'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) = 'UNIQUE (student_id, course_id, week_number)'
  ) then
    raise exception 'precondition failed: student_mission_progress has no (student, course, week) unique key';
  end if;
end $$;

create or replace function public.advance_student_week(
  p_enrollment_id uuid,
  p_expected_week integer,
  p_feedback text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile uuid := app_private.current_profile_id();
  v_school  uuid := app_private.current_school_id();
  v_course  uuid;
  v_next    integer;
begin
  if v_profile is null or v_school is null then
    return jsonb_build_object('outcome', 'unauthorized');
  end if;

  -- One statement establishes all of it: the row exists, it belongs to the
  -- caller, its course is in the caller's tenant, the expected week is still
  -- current — and the row is locked so no concurrent caller can win too.
  select sc.course_id
    into v_course
  from public.student_courses sc
  join public.courses c on c.id = sc.course_id
  where sc.id = p_enrollment_id
    and sc.student_id = v_profile
    and c.school_id = v_school
    and sc.current_week = p_expected_week
  for update of sc;

  if v_course is null then
    -- Not theirs, not their tenant, or someone else already advanced it.
    -- A zero-row match is a LOSER, never a success.
    return jsonb_build_object('outcome', 'stale');
  end if;

  -- Inside the transaction, and only now that the caller has provably won.
  insert into public.student_mission_progress
    (student_id, course_id, week_number, actual_progress_feedback)
  values (v_profile, v_course, p_expected_week, p_feedback)
  on conflict (student_id, course_id, week_number)
  do update set actual_progress_feedback = excluded.actual_progress_feedback;

  v_next := p_expected_week + 1;
  if v_next > 30 then
    -- The last week of a course has nowhere to advance to. Feedback is kept;
    -- the enrollment stays put. This matches the behaviour before this change.
    return jsonb_build_object('outcome', 'final_week', 'course_id', v_course);
  end if;

  update public.student_courses
     set current_week = v_next
   where id = p_enrollment_id;

  return jsonb_build_object(
    'outcome', 'advanced',
    'advanced_to', v_next,
    'course_id', v_course
  );
end;
$$;

-- Least privilege: revoke the PUBLIC default before granting, or EXECUTE stays
-- available to every role including anon.
revoke all on function public.advance_student_week(uuid, integer, text) from public, anon;
grant execute on function public.advance_student_week(uuid, integer, text) to authenticated;

do $$
declare
  v_oid oid;
begin
  select p.oid into v_oid
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'advance_student_week';

  if v_oid is null then
    raise exception 'postcondition failed: advance_student_week was not created';
  end if;
  if not (select prosecdef from pg_proc where oid = v_oid) then
    raise exception 'postcondition failed: advance_student_week is not SECURITY DEFINER';
  end if;
  if not exists (
    select 1 from pg_proc
    where oid = v_oid and array_to_string(proconfig, ',') like '%search_path%'
  ) then
    raise exception 'postcondition failed: advance_student_week has a mutable search_path';
  end if;
  if has_function_privilege('anon', v_oid, 'EXECUTE') then
    raise exception 'postcondition failed: anon can EXECUTE advance_student_week';
  end if;
  if not has_function_privilege('authenticated', v_oid, 'EXECUTE') then
    raise exception 'postcondition failed: authenticated cannot EXECUTE advance_student_week';
  end if;
end $$;

commit;
