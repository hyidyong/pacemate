-- Stage 9 (Codex review round) — a caller-owned row may not reference another
-- tenant's resource.
--
-- THE PATTERN. Stage 9 scoped reads by tenant and scoped writes by OWNERSHIP:
-- "is this row mine?". That is not sufficient for a row that REFERENCES a
-- tenant resource. `student_id = me` is perfectly true of an enrolment in
-- another university's course — and every feature downstream that authorizes on
-- "is enrolled" then treats that row as permission to read the other tenant's
-- material. The app-layer check added in the previous commit
-- (resolveTenantCourse) is bypassed entirely by a direct PostgREST call.
--
-- MEASURED before this migration, as a signed-in student of probe tenant A
-- writing directly to PostgREST with tenant B's UUIDs and WITHOUT asking for a
-- representation (the weakest attacker path — see below):
--
--   student_courses          foreign course_id  -> 201, row created
--   student_mission_progress foreign course_id  -> 201, row created
--   study_roadmaps           foreign course_id  -> 201, row created
--   study_tasks              foreign course_id  -> 201, row created
--   posts                    foreign school_id  -> 201, row created
--   course_reviews           foreign course_id  -> 403, denied  (already correct)
--
-- WHY "WITHOUT A REPRESENTATION" MATTERS. With `Prefer: return=representation`,
-- PostgREST re-reads the new row through the SELECT policy and rolls back if it
-- is not visible. Because Stage 9 made those SELECT policies tenant-scoped,
-- `posts` and `course_reviews` returned 403 and looked protected. They were not:
-- an attacker simply omits the header. Incidental protection that depends on a
-- request header the attacker controls is not protection, and this migration
-- makes the rule explicit in WITH CHECK where it cannot be opted out of.
--
-- `course_reviews` is left alone: its Stage 9 policy already carries the tenant
-- EXISTS clause, which is why it was the one table that denied the write for
-- the right reason. It is the pattern the others now follow.
--
-- Preconditions: no existing row already violates the rule (so this closes a
-- hole without hiding live data). Postconditions: every policy below carries a
-- tenant term.
-- Rollback: re-run 20260814010000, which restores the ownership-only policies.

begin;

do $$
begin
  if to_regprocedure('app_private.current_school_id()') is null then
    raise exception 'precondition failed: run 20260814000000_stage9_identity_helpers first';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Tenant predicates. NULL references are permitted — the columns are nullable
-- by design and a NULL reference cannot point at another tenant.
-- ---------------------------------------------------------------------------
create or replace function app_private.course_in_current_tenant(p_course_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_course_id is null or exists (
    select 1
    from public.courses c
    where c.id = p_course_id
      and c.school_id = app_private.current_school_id()
  );
$$;

create or replace function app_private.offering_in_current_tenant(p_offering_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_offering_id is null or exists (
    select 1
    from public.course_offerings o
    join public.courses c on c.id = o.course_id
    where o.id = p_offering_id
      and c.school_id = app_private.current_school_id()
  );
$$;

revoke all on function app_private.course_in_current_tenant(uuid) from public, anon;
revoke all on function app_private.offering_in_current_tenant(uuid) from public, anon;
grant execute on function app_private.course_in_current_tenant(uuid) to authenticated, service_role;
grant execute on function app_private.offering_in_current_tenant(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Preconditions: prove we are closing a hole, not hiding rows.
-- ---------------------------------------------------------------------------
do $$
declare
  bad bigint;
begin
  select count(*) into bad
  from public.student_courses sc
  join public.profiles p on p.id = sc.student_id
  join public.courses c on c.id = sc.course_id
  where c.school_id is distinct from p.school_id;
  if bad > 0 then
    raise exception 'precondition failed: % cross-tenant student_courses row(s) already exist; resolve them before tightening', bad;
  end if;

  select count(*) into bad
  from public.student_mission_progress smp
  join public.profiles p on p.id = smp.student_id
  join public.courses c on c.id = smp.course_id
  where c.school_id is distinct from p.school_id;
  if bad > 0 then
    raise exception 'precondition failed: % cross-tenant student_mission_progress row(s) already exist', bad;
  end if;

  select count(*) into bad
  from public.study_roadmaps sr
  join public.profiles p on p.id = sr.student_id
  join public.courses c on c.id = sr.course_id
  where c.school_id is distinct from p.school_id;
  if bad > 0 then
    raise exception 'precondition failed: % cross-tenant study_roadmaps row(s) already exist', bad;
  end if;

  select count(*) into bad
  from public.posts po
  join public.profiles p on p.id = po.author_id
  where po.school_id is distinct from p.school_id;
  if bad > 0 then
    raise exception 'precondition failed: % cross-tenant posts row(s) already exist', bad;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- student_courses — the enrolment primitive Codex reported.
-- ---------------------------------------------------------------------------
drop policy if exists "students manage own student courses" on public.student_courses;
create policy "students manage own student courses"
  on public.student_courses for all to authenticated
  using (
    student_id = app_private.current_profile_id()
    and app_private.course_in_current_tenant(course_id)
  )
  with check (
    student_id = app_private.current_profile_id()
    and app_private.course_in_current_tenant(course_id)
    and app_private.offering_in_current_tenant(offering_id)
  );

-- ---------------------------------------------------------------------------
-- student_mission_progress
-- ---------------------------------------------------------------------------
drop policy if exists "students manage own mission progress" on public.student_mission_progress;
create policy "students manage own mission progress"
  on public.student_mission_progress for all to authenticated
  using (
    student_id = app_private.current_profile_id()
    and app_private.course_in_current_tenant(course_id)
  )
  with check (
    student_id = app_private.current_profile_id()
    and app_private.course_in_current_tenant(course_id)
  );

-- ---------------------------------------------------------------------------
-- study_roadmaps / study_tasks. A task must additionally hang off a roadmap the
-- caller owns, so a foreign roadmap cannot be used as a parent.
-- ---------------------------------------------------------------------------
drop policy if exists "students manage own study roadmaps" on public.study_roadmaps;
create policy "students manage own study roadmaps"
  on public.study_roadmaps for all to authenticated
  using (
    student_id = app_private.current_profile_id()
    and app_private.course_in_current_tenant(course_id)
  )
  with check (
    student_id = app_private.current_profile_id()
    and app_private.course_in_current_tenant(course_id)
    and app_private.offering_in_current_tenant(offering_id)
  );

drop policy if exists "students manage own study tasks" on public.study_tasks;
create policy "students manage own study tasks"
  on public.study_tasks for all to authenticated
  using (
    student_id = app_private.current_profile_id()
    and app_private.course_in_current_tenant(course_id)
  )
  with check (
    student_id = app_private.current_profile_id()
    and app_private.course_in_current_tenant(course_id)
    and (
      roadmap_id is null
      or exists (
        select 1 from public.study_roadmaps r
        where r.id = study_tasks.roadmap_id
          and r.student_id = app_private.current_profile_id()
      )
    )
  );

-- ---------------------------------------------------------------------------
-- posts / comments — the community write path. The role↔community_type rule is
-- preserved exactly; only the tenant term is added.
-- ---------------------------------------------------------------------------
drop policy if exists "users create posts" on public.posts;
create policy "users create posts"
  on public.posts for insert to authenticated
  with check (
    status = 'active'
    and school_id = app_private.current_school_id()
    and app_private.course_in_current_tenant(course_id)
    and author_id = app_private.current_profile_id()
    and (
      (app_private.current_user_role() = 'student' and community_type = 'student')
      or (app_private.current_user_role() = 'professor' and community_type = 'professor')
    )
  );

drop policy if exists "authors update own posts" on public.posts;
create policy "authors update own posts"
  on public.posts for update to authenticated
  using (
    author_id = app_private.current_profile_id()
    and school_id = app_private.current_school_id()
  )
  with check (
    author_id = app_private.current_profile_id()
    and school_id = app_private.current_school_id()
    and app_private.course_in_current_tenant(course_id)
  );

drop policy if exists "authors delete own posts" on public.posts;
create policy "authors delete own posts"
  on public.posts for delete to authenticated
  using (
    author_id = app_private.current_profile_id()
    and school_id = app_private.current_school_id()
  );

-- A comment inherits its post's tenant. Without this a caller could comment on
-- a post in another university even though they cannot read the board.
drop policy if exists "users create comments" on public.comments;
create policy "users create comments"
  on public.comments for insert to authenticated
  with check (
    status = 'active'
    and author_id = app_private.current_profile_id()
    and exists (
      select 1 from public.posts po
      where po.id = comments.post_id
        and po.school_id = app_private.current_school_id()
        and (
          (app_private.current_user_role() = 'student' and po.community_type = 'student')
          or (app_private.current_user_role() = 'professor' and po.community_type = 'professor')
        )
    )
  );

-- Reactions carry the same reasoning as comments.
drop policy if exists "users create own community reactions" on public.post_reactions;
create policy "users create own community reactions"
  on public.post_reactions for insert to authenticated
  with check (
    user_id = app_private.current_profile_id()
    and exists (
      select 1 from public.posts po
      where po.id = post_reactions.post_id
        and po.school_id = app_private.current_school_id()
        and (
          (app_private.current_user_role() = 'student' and po.community_type = 'student')
          or (app_private.current_user_role() = 'professor' and po.community_type = 'professor')
        )
    )
  );

-- ---------------------------------------------------------------------------
-- Postconditions.
-- ---------------------------------------------------------------------------
do $$
declare
  missing text;
begin
  select string_agg(tablename || '.' || policyname, ', ')
    into missing
  from pg_policies
  where schemaname = 'public'
    and tablename in (
      'student_courses', 'student_mission_progress', 'study_roadmaps', 'study_tasks'
    )
    and cmd = 'ALL'
    and coalesce(with_check, '') not like '%current_tenant%';
  if missing is not null then
    raise exception 'postcondition failed: policy without a tenant term: %', missing;
  end if;

  select string_agg(tablename || '.' || policyname, ', ')
    into missing
  from pg_policies
  where schemaname = 'public'
    and tablename in ('posts', 'comments', 'post_reactions')
    and cmd = 'INSERT'
    and coalesce(with_check, '') not like '%current_school_id%';
  if missing is not null then
    raise exception 'postcondition failed: community insert without a tenant term: %', missing;
  end if;
end
$$;

commit;
