-- Stage 8 review round 3, finding 2 — repair the student_courses.current_week drift.
--
-- `current_week` exists in supabase/schema.sql (~:957) but NO migration ever
-- created it, so it is absent from the live database. Verified: PostgREST
-- answers 42703 "column student_courses.current_week does not exist".
--
-- Two consequences, both live today:
--   1. The dashboard's weekly-missions query selects `current_week`, so it
--      fails with 400 and the whole weekly-missions feature silently never
--      renders.
--   2. submitProgressFeedback's `.update({ current_week })` can never succeed,
--      so "advancing the enrollment" was a no-op whose error was only
--      console-logged.
--
-- This column is also the AUTHORITATIVE week the AI actions must authorize
-- against: without it, a caller-supplied week inside 1..30 is unfalsifiable.
--
-- Definition is copied verbatim from schema.sql so the snapshot and the
-- migration history agree from here on (KI-015 drift family).
alter table public.student_courses
  add column if not exists current_week int not null default 1;

-- Keeps the value inside the same range the application authorizes against, so
-- the invariant is enforced by the database rather than only by the action.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'student_courses_current_week_range'
  ) then
    alter table public.student_courses
      add constraint student_courses_current_week_range
      check (current_week between 1 and 30);
  end if;
end $$;
