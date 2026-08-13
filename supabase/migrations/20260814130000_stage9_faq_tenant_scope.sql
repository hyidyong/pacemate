-- Stage 9 (Codex round 3, F4) — a course-less FAQ is not a global FAQ.
--
-- The Stage 9 read policy was:
--
--   approved_at is not null
--   and (course_id is null or <course is in my tenant>)
--
-- so `course_id IS NULL` short-circuited the tenant test and made the row
-- visible to every university. Nothing in the product designed a global FAQ;
-- that behaviour fell out of treating a nullable column as "applies to all".
--
-- `faqs` has no tenant column, but it does have an authoritative parent:
-- `professor_id -> professors.school_id`. A FAQ is written by a professor of
-- exactly one university, so tenancy is derivable rather than something to
-- invent. Live data confirms the shape is usable: 1 row, course_id NOT null,
-- professor_id NOT null.
--
-- `professor_id` is nullable in the schema, so the policy must decide what an
-- unparented FAQ means. It is treated as visible to NOBODY through the client
-- role: a row with no course and no professor has no tenant, and defaulting an
-- unknown tenant to "everyone" is the mistake this migration exists to fix.
-- Server code using the service role is unaffected.
--
-- Preconditions: faqs exists with professor_id.
-- Postconditions: the read policy derives tenant from course OR professor, and
-- never returns a row whose tenant cannot be established.
-- Rollback: re-run the policy from 20260814010000.

begin;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'faqs' and column_name = 'professor_id'
  ) then
    raise exception 'precondition failed: faqs.professor_id is missing; tenancy cannot be derived';
  end if;
end
$$;

drop policy if exists "tenant reads approved faqs" on public.faqs;
create policy "tenant reads approved faqs"
  on public.faqs for select to authenticated
  using (
    approved_at is not null
    and (
      exists (
        select 1 from public.courses c
        where c.id = faqs.course_id
          and c.school_id = app_private.current_school_id()
      )
      or exists (
        select 1 from public.professors pr
        where pr.id = faqs.professor_id
          and pr.school_id = app_private.current_school_id()
      )
    )
  );

do $$
declare
  orphans bigint;
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'faqs' and cmd = 'SELECT'
      and qual like '%current_school_id%'
      and qual not like '%course_id IS NULL%'
  ) then
    raise exception 'postcondition failed: the FAQ read policy still treats a null course as global';
  end if;

  -- Surfaced, not silently hidden: a FAQ with neither parent is now invisible
  -- to every client role, which is the safe reading but is also a data problem
  -- somebody should fix.
  select count(*) into orphans
  from public.faqs
  where approved_at is not null and course_id is null and professor_id is null;
  if orphans > 0 then
    raise warning
      'stage9: % approved FAQ(s) have neither a course nor a professor and are now visible to no tenant', orphans;
  end if;
end
$$;

commit;
