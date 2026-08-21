-- Stage 9 — remove the `demo anon` authorization model and make the
-- authenticated policies the real boundary.
--
-- WHAT WAS TRUE BEFORE THIS MIGRATION (measured, not assumed)
--
-- `scripts/security/rls-probe.mjs` provisioned two disposable tenants and
-- attacked them over plain PostgREST with the publishable key alone — the same
-- key that ships in the browser bundle. 26 of 67 checks failed. Confirmed
-- WITHOUT ANY AUTHENTICATION:
--
--   * read every row of profiles (27), student_profiles (12), student_courses
--     (12), syllabi (5, incl. raw_extracted_text), professor_teaching_slots
--     (22), professor_availability (9), roadmap_revision_requests (3)
--   * PATCH any profile (a probe profile's name was rewritten)
--   * POST a new profile with role = 'admin' (HTTP 201)
--   * POST and PATCH professor_availability — fabricate or delete bookable
--     counseling slots for any professor (correctness-critical per CLAUDE.md)
--   * PATCH student_courses.current_week and student_mission_progress
--   * POST a user_notifications row addressed to any recipient with any
--     target_href
--
-- And, signed in as a student of another tenant: read another tenant's
-- student_mission_progress, professor_admin_tasks, syllabi, courses and
-- professor directory, and rewrite another tenant's mission progress.
--
-- WHY THE ANON POLICIES EXISTED
--
-- They are demo scaffolding from 2026-07-03. They were load-bearing because the
-- authenticated policies were dead (see 20260814000000): the browser silently
-- fell through to `anon` and everything worked. That is why this migration must
-- come after the identity-helper migration and not before.
--
-- WHAT STAYS PUBLIC
--
-- `schools` only. It is the tenant registry a caller needs before it has any
-- identity (SSO slug resolution, login). It holds a name, a slug and a status —
-- no personal data. Everything else now requires a session.
--
-- Preconditions asserted: app_private helpers exist.
-- Postconditions asserted: anon holds no privilege on any table except a SELECT
-- on schools; no policy named 'demo %' survives.
-- Rollback: this migration is destructive to policy definitions. To restore the
-- previous (insecure) behaviour, re-run 20260703041159, 20260703161724,
-- 20260703164629, 20260703134711, 20260704152029, 20260703141029 and the
-- relevant CREATE POLICY blocks in supabase/schema.sql. Do not do this.

begin;

do $$
begin
  if to_regprocedure('app_private.current_profile_id()') is null then
    raise exception 'precondition failed: run 20260814000000_stage9_identity_helpers first';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 1. profiles — identity itself. anon could read the whole directory and
--    rewrite `role` and `auth_user_id`, which is account takeover.
-- ---------------------------------------------------------------------------
drop policy if exists "demo anon read profiles by identifier" on public.profiles;
drop policy if exists "demo anon create profiles" on public.profiles;
drop policy if exists "demo anon update profiles" on public.profiles;
drop policy if exists "users update own profile" on public.profiles;

-- A user may edit their own display name. Role, tenant and auth binding are not
-- writable from a session at all — those are service-role/onboarding concerns.
create policy "users update own profile"
  on public.profiles for update to authenticated
  using (auth_user_id = (select auth.uid()))
  with check (auth_user_id = (select auth.uid()));

-- Same-tenant directory read: the counseling and community surfaces need to
-- resolve names inside one university. It deliberately does NOT cross tenants.
drop policy if exists "profiles readable within the tenant" on public.profiles;
create policy "profiles readable within the tenant"
  on public.profiles for select to authenticated
  using (
    auth_user_id = (select auth.uid())
    or school_id = app_private.current_school_id()
  );

revoke all on public.profiles from anon;
revoke update on public.profiles from authenticated;
grant update (name) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- 2. student_profiles / student_courses / student_mission_progress —
--    per-student records. All three carried `for all to anon`, and all three
--    authenticated predicates were dead.
-- ---------------------------------------------------------------------------
drop policy if exists "demo anon manage student profiles" on public.student_profiles;
drop policy if exists "users read own student profile" on public.student_profiles;
drop policy if exists "users create own student profile" on public.student_profiles;
drop policy if exists "users update own student profile" on public.student_profiles;
drop policy if exists "users delete own student profile" on public.student_profiles;

create policy "students manage own student profile"
  on public.student_profiles for all to authenticated
  using (profile_id = app_private.current_profile_id())
  with check (profile_id = app_private.current_profile_id());

revoke all on public.student_profiles from anon;

drop policy if exists "demo anon manage student courses" on public.student_courses;
drop policy if exists "users manage own student courses" on public.student_courses;
drop policy if exists "students read own student courses for questions" on public.student_courses;

create policy "students manage own student courses"
  on public.student_courses for all to authenticated
  using (student_id = app_private.current_profile_id())
  with check (student_id = app_private.current_profile_id());

revoke all on public.student_courses from anon;

drop policy if exists "demo manage student_mission_progress" on public.student_mission_progress;

create policy "students manage own mission progress"
  on public.student_mission_progress for all to authenticated
  using (student_id = app_private.current_profile_id())
  with check (student_id = app_private.current_profile_id());

revoke all on public.student_mission_progress from anon;

-- ---------------------------------------------------------------------------
-- 3. professor_availability / professor_teaching_slots — scheduling data.
--    CLAUDE.md: "Treat scheduling availability as correctness-critical data."
--    anon could open, close and invent counseling windows for any professor.
-- ---------------------------------------------------------------------------
drop policy if exists "demo anon manage availability" on public.professor_availability;
drop policy if exists "demo anon manage professor availability" on public.professor_availability;
drop policy if exists "public read active availability" on public.professor_availability;

-- Students need to see bookable windows; they only ever need their own tenant's.
create policy "tenant reads active availability"
  on public.professor_availability for select to authenticated
  using (
    is_active
    and exists (
      select 1 from public.professors pr
      where pr.id = professor_availability.professor_id
        and pr.school_id = app_private.current_school_id()
    )
  );

-- A professor manages their own windows, and can see their inactive ones too.
create policy "professors manage own availability"
  on public.professor_availability for all to authenticated
  using (professor_id = app_private.current_professor_id())
  with check (professor_id = app_private.current_professor_id());

revoke all on public.professor_availability from anon;

drop policy if exists "demo anon manage professor teaching slots" on public.professor_teaching_slots;
drop policy if exists "public read professor teaching slots" on public.professor_teaching_slots;

create policy "tenant reads professor teaching slots"
  on public.professor_teaching_slots for select to authenticated
  using (
    exists (
      select 1 from public.professors pr
      where pr.id = professor_teaching_slots.professor_id
        and pr.school_id = app_private.current_school_id()
    )
  );

create policy "professors manage own teaching slots"
  on public.professor_teaching_slots for all to authenticated
  using (professor_id = app_private.current_professor_id())
  with check (professor_id = app_private.current_professor_id());

revoke all on public.professor_teaching_slots from anon;

-- ---------------------------------------------------------------------------
-- 4. Catalog: courses, departments, professors, course_professors, syllabi.
--    These were `using (true)` to anon AND to authenticated, so the Stage 9
--    probe read another tenant's catalog and professor directory (incl. email
--    and phone) with a signed-in account from a different university.
-- ---------------------------------------------------------------------------
drop policy if exists "public read courses" on public.courses;
create policy "tenant reads courses"
  on public.courses for select to authenticated
  using (school_id = app_private.current_school_id());
revoke all on public.courses from anon;

drop policy if exists "public read departments" on public.departments;
create policy "tenant reads departments"
  on public.departments for select to authenticated
  using (school_id = app_private.current_school_id());
revoke all on public.departments from anon;

drop policy if exists "public read professors" on public.professors;
create policy "tenant reads professors"
  on public.professors for select to authenticated
  using (school_id = app_private.current_school_id());
revoke all on public.professors from anon;

drop policy if exists "public read course professors" on public.course_professors;
create policy "tenant reads course professors"
  on public.course_professors for select to authenticated
  using (
    exists (
      select 1 from public.courses c
      where c.id = course_professors.course_id
        and c.school_id = app_private.current_school_id()
    )
  );
revoke all on public.course_professors from anon;

-- Syllabi carry raw_extracted_text — the full text of uploaded course material.
drop policy if exists "public read syllabi" on public.syllabi;
create policy "tenant reads syllabi"
  on public.syllabi for select to authenticated
  using (
    exists (
      select 1 from public.courses c
      where c.id = syllabi.course_id
        and c.school_id = app_private.current_school_id()
    )
  );
revoke all on public.syllabi from anon;

-- ---------------------------------------------------------------------------
-- 5. faqs / course_reviews / notices — content surfaces that had anon write.
-- ---------------------------------------------------------------------------
drop policy if exists "demo anon manage faqs" on public.faqs;
drop policy if exists "demo anon manage professor faqs" on public.faqs;
drop policy if exists "public read approved faqs" on public.faqs;

create policy "tenant reads approved faqs"
  on public.faqs for select to authenticated
  using (
    approved_at is not null
    and (
      course_id is null
      or exists (
        select 1 from public.courses c
        where c.id = faqs.course_id
          and c.school_id = app_private.current_school_id()
      )
    )
  );
revoke all on public.faqs from anon;
-- FAQ creation is a professor/assistant action and now runs server-side under
-- the service role after an explicit ownership check; no session-role INSERT.
revoke insert, update, delete on public.faqs from authenticated;

drop policy if exists "demo anon create course reviews" on public.course_reviews;
drop policy if exists "demo anon update course reviews" on public.course_reviews;
drop policy if exists "public read reviews" on public.course_reviews;
drop policy if exists "users create reviews" on public.course_reviews;
drop policy if exists "authors update own reviews" on public.course_reviews;

create policy "tenant reads course reviews"
  on public.course_reviews for select to authenticated
  using (
    exists (
      select 1 from public.courses c
      where c.id = course_reviews.course_id
        and c.school_id = app_private.current_school_id()
    )
  );

create policy "authors write own course reviews"
  on public.course_reviews for insert to authenticated
  with check (
    author_id = app_private.current_profile_id()
    and exists (
      select 1 from public.courses c
      where c.id = course_reviews.course_id
        and c.school_id = app_private.current_school_id()
    )
  );

create policy "authors update own course reviews"
  on public.course_reviews for update to authenticated
  using (author_id = app_private.current_profile_id())
  with check (author_id = app_private.current_profile_id());

revoke all on public.course_reviews from anon;

drop policy if exists "public read notices" on public.notices;
create policy "authenticated read notices"
  on public.notices for select to authenticated
  using (true);
revoke all on public.notices from anon;

-- ---------------------------------------------------------------------------
-- 6. roadmap_revision_requests — the curriculum approval workflow. anon could
--    read it, submit into it, AND move a row to `approved`, which publishes a
--    patch into every student's roadmap.
-- ---------------------------------------------------------------------------
drop policy if exists "demo create roadmap revision requests" on public.roadmap_revision_requests;
drop policy if exists "demo read roadmap revision requests" on public.roadmap_revision_requests;
drop policy if exists "demo review roadmap revision requests" on public.roadmap_revision_requests;

-- An APPROVED revision is published curriculum content — students read it to
-- render their roadmap, so it stays visible to any signed-in user. Everything
-- still in the workflow is visible only to its proposer and to staff. The
-- approval transition itself is now exclusively a server-side, role-checked
-- action running under the service role, so no session role gets UPDATE at all.
create policy "published revisions and own workflow rows are readable"
  on public.roadmap_revision_requests for select to authenticated
  using (
    status = 'approved'
    or proposed_by = app_private.current_profile_id()
    or app_private.current_user_role() in ('assistant', 'admin', 'professor')
  );

revoke all on public.roadmap_revision_requests from anon;
revoke insert, update, delete on public.roadmap_revision_requests from authenticated;

-- ---------------------------------------------------------------------------
-- 7. user_notifications — Stage 8 closed SELECT/UPDATE and deliberately left
--    INSERT open to anon for the sessionless /support flow. The probe confirmed
--    that this lets an unauthenticated caller deliver a notification with an
--    arbitrary title, body and target_href to any recipient. /support now
--    submits through a server action that writes under the service role, so
--    the client-role INSERT is no longer needed by anything.
-- ---------------------------------------------------------------------------
drop policy if exists "demo create notifications" on public.user_notifications;
revoke all on public.user_notifications from anon;
revoke insert on public.user_notifications from authenticated;

-- ---------------------------------------------------------------------------
-- 8. professor_admin_tasks — SELECT was `using (true)` to authenticated, so any
--    signed-in user read every professor's private task list, cross-tenant.
-- ---------------------------------------------------------------------------
drop policy if exists "authenticated read professor admin tasks" on public.professor_admin_tasks;
create policy "professors and tenant staff read admin tasks"
  on public.professor_admin_tasks for select to authenticated
  using (
    exists (
      select 1 from public.professors pr
      where pr.id = professor_admin_tasks.professor_id
        and pr.school_id = app_private.current_school_id()
        and (
          pr.id = app_private.current_professor_id()
          or app_private.current_user_role() in ('assistant', 'admin')
        )
    )
  );

-- ---------------------------------------------------------------------------
-- 9. escalations — the assistant read policy had no tenant or course term, so
--    any assistant read every student question on the platform. Mirror the
--    clause the answer RPC already enforces.
-- ---------------------------------------------------------------------------
drop policy if exists "assistants read professor questions" on public.escalations;
create policy "assistants read tenant professor questions"
  on public.escalations for select to authenticated
  using (
    app_private.current_user_role() = 'assistant'
    and exists (
      select 1 from public.courses c
      where c.id = escalations.course_id
        and c.school_id = app_private.current_school_id()
    )
  );

-- ---------------------------------------------------------------------------
-- 10. Remaining pre-mapping identity predicates (roadmap_requests /
--     roadmap_results / counseling_requests professor side).
-- ---------------------------------------------------------------------------
drop policy if exists "users manage own roadmap requests" on public.roadmap_requests;
create policy "students manage own roadmap requests"
  on public.roadmap_requests for all to authenticated
  using (student_id = app_private.current_profile_id())
  with check (student_id = app_private.current_profile_id());

drop policy if exists "users read own roadmap results" on public.roadmap_results;
create policy "students read own roadmap results"
  on public.roadmap_results for select to authenticated
  using (
    exists (
      select 1 from public.roadmap_requests rr
      where rr.id = roadmap_results.request_id
        and rr.student_id = app_private.current_profile_id()
    )
  );

drop policy if exists "professors update own counseling requests" on public.counseling_requests;
create policy "professors update own counseling requests"
  on public.counseling_requests for update to authenticated
  using (professor_id = app_private.current_professor_id())
  with check (professor_id = app_private.current_professor_id());

drop policy if exists "users read own counseling requests" on public.counseling_requests;
create policy "participants read own counseling requests"
  on public.counseling_requests for select to authenticated
  using (
    student_id = app_private.current_profile_id()
    or professor_id = app_private.current_professor_id()
  );

-- ---------------------------------------------------------------------------
-- 11. posts — the community policies match ROLE to community_type but never
--     tenant, so a student of university A could read university B's student
--     board. `posts.school_id` is NOT NULL as of 20260812070000, so the tenant
--     term can simply be added.
-- ---------------------------------------------------------------------------
drop policy if exists "users read matching community posts" on public.posts;
create policy "users read matching community posts"
  on public.posts for select to authenticated
  using (
    status = 'active'
    and school_id = app_private.current_school_id()
    and (
      (app_private.current_user_role() = 'student' and community_type = 'student')
      or (app_private.current_user_role() = 'professor' and community_type = 'professor')
    )
  );

-- ---------------------------------------------------------------------------
-- 12. Blanket close-out. Anything not named above that still grants `anon` a
--     privilege is closed here, so the anon surface is defined by an explicit
--     allowlist of exactly one table rather than by whichever migrations
--     happened to remember to revoke.
-- ---------------------------------------------------------------------------
do $$
declare
  rec record;
begin
  for rec in
    select distinct table_name
    from information_schema.role_table_grants
    where table_schema = 'public'
      and grantee = 'anon'
      and table_name <> 'schools'
  loop
    execute format('revoke all on public.%I from anon', rec.table_name);
  end loop;
end
$$;

alter default privileges in schema public revoke all on tables from anon;

-- ---------------------------------------------------------------------------
-- Postconditions.
-- ---------------------------------------------------------------------------
do $$
declare
  leftover text;
  anon_grants text;
begin
  -- `schools` is the single intended exception: the tenant registry a caller
  -- must be able to read before it has any identity.
  select string_agg(tablename || '.' || policyname, ', ')
    into leftover
  from pg_policies
  where schemaname = 'public'
    and 'anon' = any(roles)
    and tablename <> 'schools';
  if leftover is not null then
    raise exception 'postcondition failed: anon still has policies: %', leftover;
  end if;

  select string_agg(table_name || ':' || privilege_type, ', ')
    into anon_grants
  from information_schema.role_table_grants
  where table_schema = 'public'
    and grantee = 'anon'
    and table_name <> 'schools';
  if anon_grants is not null then
    raise exception 'postcondition failed: anon still holds table grants: %', anon_grants;
  end if;

  select string_agg(tablename || '.' || policyname, ', ')
    into leftover
  from pg_policies
  where schemaname = 'public' and policyname like 'demo %';
  if leftover is not null then
    raise exception 'postcondition failed: demo policies survive: %', leftover;
  end if;
end
$$;

commit;
