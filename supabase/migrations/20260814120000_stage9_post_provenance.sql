-- Stage 9 (Codex round 3, F3) — a post cannot promote itself into trusted content.
--
-- WHY THIS MATTERS. `board_key = 'course_notice'` is not a display label; it is
-- a TRUST MARKER. Rows carrying it are read with the SERVICE ROLE and fed to
-- consumers that treat them as course-authoritative:
--
--   ai-tutor-rag.actions.ts:243        cited evidence in a student's AI answer
--   professor-grounded-answer.server.ts:114  evidence in a professor's draft
--   course-notices.server.ts:40        rendered to students as a course notice
--
-- The only legitimate writer is course-settings.actions.ts, which verifies the
-- professor owns the course and writes through the service role.
--
-- WHAT WAS WRONG. The Stage 9 UPDATE policy constrained author, school and
-- course but said nothing about `community_type` or `board_key`. A student could
-- therefore create an ordinary post and then PATCH it into
-- `community_type = 'professor'` and `board_key = 'course_notice'`, injecting
-- attacker text into the AI tutor's cited course-notice evidence for a course
-- they are enrolled in. INSERT was partly protected — the role<->community
-- pairing is checked — but `board_key` was unconstrained there too, so a student
-- could simply CREATE a `course_notice` directly.
--
-- THE FIX, in two parts.
--
-- 1. Provenance becomes immutable. The application performs no UPDATE on
--    `posts` through a client role at all, so the provenance columns are made
--    unwritable with column-level privileges rather than policed by a predicate
--    that must remember every column. Authors keep editing what a post IS —
--    title, content, its own resolution state — and cannot change who wrote it,
--    which university it belongs to, which community it lives in, or whether it
--    is a trusted notice.
--
-- 2. Privileged board keys are refused on INSERT for client roles. Professors
--    still publish notices through the authorized server path, which runs as
--    service_role and is unaffected.
--
-- Preconditions: no existing post would be invalidated.
-- Postconditions: provenance columns unwritable by client roles; a client-role
-- INSERT cannot carry a privileged board key; the legitimate columns remain.
-- Rollback: re-grant UPDATE and drop the board-key term.

begin;

/**
 * Board keys that mark a post as course-authoritative. Only the server may
 * create these. Kept as a function so both the policy and future callers agree
 * on one definition.
 */
create or replace function app_private.is_privileged_board_key(p_board_key text)
returns boolean
language sql
immutable
as $$
  select coalesce(p_board_key, '') in ('course_notice');
$$;

revoke all on function app_private.is_privileged_board_key(text) from public, anon;
grant execute on function app_private.is_privileged_board_key(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1. Provenance immutability.
-- ---------------------------------------------------------------------------
revoke update on public.posts from authenticated, anon;
grant update (title, content, status, is_resolved, resolved_by_post_id, view_count, updated_at)
  on public.posts to authenticated;

-- ---------------------------------------------------------------------------
-- 2. A client role may not create a trusted notice.
-- ---------------------------------------------------------------------------
drop policy if exists "users create posts" on public.posts;
create policy "users create posts"
  on public.posts for insert to authenticated
  with check (
    status = 'active'
    and school_id = app_private.current_school_id()
    and app_private.course_in_current_tenant(course_id)
    and author_id = app_private.current_profile_id()
    and not app_private.is_privileged_board_key(board_key)
    and (
      (app_private.current_user_role() = 'student' and community_type = 'student')
      or (app_private.current_user_role() = 'professor' and community_type = 'professor')
    )
  );

-- The UPDATE policy keeps its ownership and tenant terms. It no longer needs to
-- enumerate provenance columns, because they are not writable.
drop policy if exists "authors update own posts" on public.posts;
create policy "authors update own posts"
  on public.posts for update to authenticated
  using (
    author_id = app_private.current_profile_id()
    and school_id = app_private.current_school_id()
    and not app_private.is_privileged_board_key(board_key)
  )
  with check (
    author_id = app_private.current_profile_id()
    and school_id = app_private.current_school_id()
  );

do $$
declare
  writable text;
begin
  select string_agg(column_name, ', ' order by column_name)
    into writable
  from information_schema.column_privileges
  where table_schema = 'public'
    and table_name = 'posts'
    and grantee in ('authenticated', 'anon')
    and privilege_type = 'UPDATE'
    and column_name in ('author_id', 'school_id', 'community_type', 'board_key', 'course_id', 'id', 'created_at');
  if writable is not null then
    raise exception 'postcondition failed: post provenance is still writable: %', writable;
  end if;

  if not exists (
    select 1 from information_schema.column_privileges
    where table_schema = 'public' and table_name = 'posts'
      and grantee = 'authenticated' and privilege_type = 'UPDATE' and column_name = 'content'
  ) then
    raise exception 'postcondition failed: authors can no longer edit their own post content';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'posts' and cmd = 'INSERT'
      and with_check like '%is_privileged_board_key%'
  ) then
    raise exception 'postcondition failed: a client role can still create a trusted notice';
  end if;
end
$$;

commit;
