-- Stage 9 (Codex round 4, finding 2) — a course review is STUDENT experience.
--
-- THE DEFECT. `/reviews` has always been gated by `redirectNonStudent`, so the
-- product has always said reviews are written by students. Nothing below the
-- route agreed. The INSERT policy asked two questions:
--
--   author_id = app_private.current_profile_id()        -- is it yours?
--   exists (course in app_private.current_school_id())  -- is it your tenant?
--
-- Both true for a professor reviewing a colleague's course. The server action
-- checked only that a session existed. So any authenticated staff member —
-- professor, assistant or admin — could publish a student-voice review, in
-- their own name, and it would render beside genuine ones. Proven live: all
-- three roles posted a same-tenant self-authored review and got 201 with the
-- row persisted (deny:professor-review, deny:assistant-review,
-- deny:admin-review, verified by service-role read-back).
--
-- The route guard was the only enforcement, and a route guard is not one: a
-- server action runs before any page renders, and PostgREST is reachable
-- directly with the publishable key. This is the same shape as the Stage 9
-- root finding.
--
-- THE FIX. One more term in the INSERT policy, using the identity helper that
-- already exists. Enforced in the database, and independently in the server
-- action, so neither is the single point of failure.
--
-- WHY INSERT ONLY. UPDATE keeps `author_id = current_profile_id()` without a
-- role term, deliberately. Once no staff member can CREATE a review, the only
-- rows that exist are student-authored, and the threat — publishing staff
-- opinion as student experience — is closed at the point of publication. Adding
-- a role term to UPDATE would additionally freeze a student's own past reviews
-- the moment their role changed, which is a product decision nobody asked for.
--
-- ENROLMENT IS NOT REQUIRED. No repository or product evidence says a reviewer
-- must have taken the course, so none is invented here. That remains a product
-- decision, recorded in KNOWN_ISSUES rather than smuggled into a security fix.
--
-- Preconditions: course_reviews exists; app_private.current_user_role() exists.
-- Verified live before writing this: 0 course_reviews rows exist at all, so no
-- backfill question arises and no existing author loses anything.
-- Postconditions: the INSERT policy references current_user_role(); the UPDATE
-- policy still exists and still binds the author.
-- Rollback: drop the role term — but staff could publish again.

begin;

do $$
begin
  if to_regclass('public.course_reviews') is null then
    raise exception 'precondition failed: public.course_reviews is missing';
  end if;
  if to_regproc('app_private.current_user_role') is null then
    raise exception 'precondition failed: app_private.current_user_role() is missing';
  end if;
end $$;

drop policy if exists "authors write own course reviews" on public.course_reviews;

create policy "students write own course reviews"
  on public.course_reviews
  for insert
  to authenticated
  with check (
    author_id = app_private.current_profile_id()
    and app_private.current_user_role() = 'student'
    and exists (
      select 1 from public.courses c
      where c.id = course_reviews.course_id
        and c.school_id = app_private.current_school_id()
    )
  );

do $$
declare
  insert_check text;
  update_using text;
begin
  select with_check into insert_check
  from pg_policies
  where schemaname = 'public' and tablename = 'course_reviews' and cmd = 'INSERT';

  if insert_check is null then
    raise exception 'postcondition failed: course_reviews has no INSERT policy';
  end if;
  if insert_check not like '%current_user_role%' then
    raise exception 'postcondition failed: the INSERT policy does not constrain the caller role: %', insert_check;
  end if;
  if insert_check not like '%current_profile_id%' or insert_check not like '%current_school_id%' then
    raise exception 'postcondition failed: the INSERT policy lost its author or tenant term: %', insert_check;
  end if;

  -- The legitimate student edit path must survive this migration.
  select qual into update_using
  from pg_policies
  where schemaname = 'public' and tablename = 'course_reviews' and cmd = 'UPDATE';
  if update_using is null or update_using not like '%current_profile_id%' then
    raise exception 'postcondition failed: the author UPDATE policy is missing or unbound';
  end if;
end $$;

commit;
