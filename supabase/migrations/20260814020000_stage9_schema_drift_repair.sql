-- Stage 9 — make the live schema reproducible from the migration chain.
--
-- Ten columns exist in the live database and in `supabase/schema.sql` but are
-- created by no migration. They were applied by hand through the SQL editor.
-- Verified live (`select=<col>&limit=0` → 206) and verified absent from every
-- file in supabase/migrations (grep):
--
--   posts.school_id, board_key, display_mode, anonymous_alias, view_count,
--   is_resolved, resolved_by_post_id
--   counseling_requests.suggested_start, suggested_end, location
--
-- Seven of them are load-bearing in `src/` and `posts.school_id` is the tenant
-- column the Stage 6 backfill asserts on. This is the same class of defect
-- 20260714204100 already fixed once for two whole tables, and the same class
-- Stage 8 fixed for `student_courses.current_week`.
--
-- Consequence before this migration: a database built from the migration chain
-- alone aborts, so there is no way to stand up staging, rehearse a restore, or
-- rebuild after an incident. That is why this is Stage 9 work and not tidying.
--
-- `posts.school_id` itself is repaired at its first point of use
-- (20260812070000), because a column created here — after the migration that
-- asserts on it — would not help a fresh rebuild. That edit is a no-op on any
-- database where it already ran. See DECISIONS.md D-024.
--
-- This migration is a no-op against the live database: every statement is
-- `if not exists`. It exists so the chain can rebuild the schema elsewhere.
--
-- Preconditions asserted: posts and counseling_requests exist.
-- Postconditions asserted: all ten columns are present.
-- Rollback: not applicable — additive and idempotent.

begin;

do $$
begin
  if to_regclass('public.posts') is null or to_regclass('public.counseling_requests') is null then
    raise exception 'precondition failed: base tables missing';
  end if;
end
$$;

alter table public.posts
  add column if not exists school_id uuid references public.schools(id) on delete set null,
  add column if not exists board_key text not null default 'question',
  add column if not exists display_mode text not null default 'anonymous',
  add column if not exists anonymous_alias text,
  add column if not exists view_count integer not null default 0,
  add column if not exists is_resolved boolean not null default false,
  add column if not exists resolved_by_post_id uuid references public.posts(id) on delete set null;

alter table public.counseling_requests
  add column if not exists suggested_start timestamptz,
  add column if not exists suggested_end timestamptz,
  add column if not exists location text;

do $$
declare
  missing text;
begin
  select string_agg(t || '.' || c, ', ')
    into missing
  from (
    values
      ('posts', 'school_id'), ('posts', 'board_key'), ('posts', 'display_mode'),
      ('posts', 'anonymous_alias'), ('posts', 'view_count'), ('posts', 'is_resolved'),
      ('posts', 'resolved_by_post_id'),
      ('counseling_requests', 'suggested_start'), ('counseling_requests', 'suggested_end'),
      ('counseling_requests', 'location')
  ) as expected(t, c)
  where not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = expected.t and column_name = expected.c
  );

  if missing is not null then
    raise exception 'postcondition failed: still missing %', missing;
  end if;
end
$$;

commit;
