-- APPLIED 2026-08-12 by the project owner via the Supabase SQL editor (NOT
-- `supabase db push`, so the CLI migration history may not list it — see
-- docs/upgrade/KNOWN_ISSUES.md KI-006 before the next push). Verified via
-- PostgREST: authenticated reads of course_offerings / student_weekly_progress
-- / student_course_progress no longer return 42P17, and the professor
-- 과목 진행 현황 report renders live. The app-level admin-client workarounds
-- (KI-006) are now redundant; revert them to session reads in Stage 2.
--
-- Root cause: two mutually recursive RLS policies make EVERY authenticated
-- SELECT on public.course_offerings fail with 42P17 "infinite recursion":
--   * "students read own course offerings" (20260712183907) subqueries
--     student_weekly_progress, and
--   * "professors read own weekly aggregate evidence" (20260713013521) on
--     student_weekly_progress subqueries course_offerings back.
-- ("professors read own student course progress" on student_course_progress
-- reaches course_offerings too and dies through the same cycle.)
--
-- Fix: evaluate the ownership subqueries through SECURITY DEFINER helpers so
-- policy evaluation never re-enters the other table's policies.

begin;

create or replace function public.is_professor_of_offering(p_offering_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.course_offerings offering
    join public.professors professor
      on professor.id = offering.professor_id
    join public.profiles professor_profile
      on professor_profile.id = professor.profile_id
    where offering.id = p_offering_id
      and professor_profile.auth_user_id = (select auth.uid())
      and professor_profile.role = 'professor'
  );
$$;

create or replace function public.is_student_of_offering(p_offering_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.student_weekly_progress swp
    join public.profiles p on p.id = swp.student_id
    where swp.offering_id = p_offering_id
      and p.auth_user_id = (select auth.uid())
      and p.role = 'student'
  );
$$;

revoke all on function public.is_professor_of_offering(uuid) from public, anon;
grant execute on function public.is_professor_of_offering(uuid) to authenticated;
revoke all on function public.is_student_of_offering(uuid) from public, anon;
grant execute on function public.is_student_of_offering(uuid) to authenticated;

drop policy if exists "professors read own weekly aggregate evidence"
  on public.student_weekly_progress;
create policy "professors read own weekly aggregate evidence"
  on public.student_weekly_progress
  for select
  to authenticated
  using (public.is_professor_of_offering(offering_id));

drop policy if exists "professors read own student course progress"
  on public.student_course_progress;
create policy "professors read own student course progress"
  on public.student_course_progress
  for select
  to authenticated
  using (public.is_professor_of_offering(offering_id));

drop policy if exists "students read own course offerings"
  on public.course_offerings;
create policy "students read own course offerings"
  on public.course_offerings
  for select
  to authenticated
  using (public.is_student_of_offering(id));

commit;
