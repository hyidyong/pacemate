-- Extend the canonical weekly progress row instead of introducing a second
-- source of truth for the same student/offering/week tuple.

begin;

alter table public.student_weekly_progress
  add column if not exists difficulty_rating text,
  add column if not exists professor_memo text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'student_weekly_progress_difficulty_rating_check'
      and conrelid = 'public.student_weekly_progress'::regclass
  ) then
    alter table public.student_weekly_progress
      add constraint student_weekly_progress_difficulty_rating_check
      check (difficulty_rating is null or difficulty_rating in ('HIGH', 'MID', 'LOW'));
  end if;
end
$$;

update public.student_weekly_progress
set difficulty_rating = case
  when difficulty_level >= 4 then 'HIGH'
  when difficulty_level = 3 then 'MID'
  when difficulty_level <= 2 then 'LOW'
end
where difficulty_rating is null
  and difficulty_level is not null;

update public.student_weekly_progress
set professor_memo = shared_feedback
where professor_memo is null
  and share_feedback_with_professor = true
  and nullif(btrim(shared_feedback), '') is not null;

create index if not exists student_weekly_progress_offering_feedback_idx
  on public.student_weekly_progress(offering_id, week_number, difficulty_rating)
  where difficulty_rating is not null or professor_memo is not null;

comment on column public.student_weekly_progress.difficulty_rating is
  'Student-reported weekly difficulty: HIGH, MID, or LOW.';
comment on column public.student_weekly_progress.professor_memo is
  'Student feedback intentionally shared with the professor or teaching assistant.';

-- The existing RLS policies still decide which rows a student/professor can
-- read. Column grants deliberately expose the shared memo, never private_note.
grant select (difficulty_rating, professor_memo, updated_at)
  on public.student_weekly_progress to authenticated;

grant select (title, topic)
  on public.course_weekly_plans to authenticated;

drop policy if exists "professors read own weekly feedback plan labels"
  on public.course_weekly_plans;
create policy "professors read own weekly feedback plan labels"
  on public.course_weekly_plans
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.course_offerings offering
      join public.professors professor on professor.id = offering.professor_id
      join public.profiles professor_profile on professor_profile.id = professor.profile_id
      where offering.id = course_weekly_plans.offering_id
        and professor_profile.auth_user_id = (select auth.uid())
        and professor_profile.role = 'professor'
    )
  );

do $$
begin
  if not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'student_weekly_progress'
      and c.relrowsecurity
  ) then
    raise exception 'student_weekly_progress must keep RLS enabled';
  end if;

  if has_column_privilege('authenticated', 'public.student_weekly_progress', 'private_note', 'SELECT') then
    raise exception 'private_note must not be readable through the authenticated Data API role';
  end if;

  if not has_column_privilege('authenticated', 'public.student_weekly_progress', 'professor_memo', 'SELECT') then
    raise exception 'professor_memo grant verification failed';
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'course_weekly_plans'
      and policyname = 'professors read own weekly feedback plan labels'
      and cmd = 'SELECT'
      and roles = array['authenticated']::name[]
  ) then
    raise exception 'professor weekly plan label policy verification failed';
  end if;
end
$$;

commit;
