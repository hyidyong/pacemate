-- Stage 9 (Codex round 3, F2) — a review cannot be moved to another tenant.
--
-- `authors update own course reviews` was `USING (author_id = me)` with the same
-- WITH CHECK. `author_id` was therefore already safe: the CHECK forces it to
-- stay me. `course_id` was not constrained at all, so an authenticated user
-- could create a legitimate review in their own university and then PATCH
-- `course_id` to a course in another one — planting content against a foreign
-- tenant's course, which the tenant-scoped SELECT policy then shows to that
-- tenant's students.
--
-- THE FIX. The application performs no UPDATE on this table at all (it inserts
-- through reviews.actions.ts and reads through reviews.service.ts), so the
-- provenance columns can simply be made unwritable rather than policed with a
-- predicate. Column-level privileges are the engine's own mechanism for this and
-- cannot be bypassed by a crafted request, unlike a predicate that has to
-- remember every column.
--
-- Editable: the review's content and its ratings — what a review IS.
-- Immutable: who wrote it, which course it is about, when it was created.
--
-- Preconditions: the table and its author policy exist.
-- Postconditions: authenticated may not write course_id or author_id; it may
-- still write the content columns; service_role is unaffected.
-- Rollback: `grant update on public.course_reviews to authenticated`.

begin;

do $$
begin
  if to_regclass('public.course_reviews') is null then
    raise exception 'precondition failed: course_reviews is missing';
  end if;
end
$$;

-- Revoke wholesale, then grant an exact column allowlist.
revoke update on public.course_reviews from authenticated, anon;
grant update (difficulty, workload, grading_style, team_project, content, updated_at)
  on public.course_reviews to authenticated;

-- The predicate keeps its ownership term; the tenant term is now redundant for
-- UPDATE because course_id can no longer change, but the INSERT policy still
-- carries it (a review must be created against a course in the caller's tenant).
drop policy if exists "authors update own course reviews" on public.course_reviews;
create policy "authors update own course reviews"
  on public.course_reviews for update to authenticated
  using (
    author_id = app_private.current_profile_id()
    and exists (
      select 1 from public.courses c
      where c.id = course_reviews.course_id
        and c.school_id = app_private.current_school_id()
    )
  )
  with check (author_id = app_private.current_profile_id());

do $$
declare
  writable text;
begin
  select string_agg(column_name, ', ' order by column_name)
    into writable
  from information_schema.column_privileges
  where table_schema = 'public'
    and table_name = 'course_reviews'
    and grantee = 'authenticated'
    and privilege_type = 'UPDATE'
    and column_name in ('course_id', 'author_id', 'id', 'created_at');
  if writable is not null then
    raise exception 'postcondition failed: provenance columns are still writable: %', writable;
  end if;

  -- The legitimate edit must survive.
  if not exists (
    select 1 from information_schema.column_privileges
    where table_schema = 'public' and table_name = 'course_reviews'
      and grantee = 'authenticated' and privilege_type = 'UPDATE' and column_name = 'content'
  ) then
    raise exception 'postcondition failed: authors can no longer edit their review content';
  end if;
end
$$;

commit;
