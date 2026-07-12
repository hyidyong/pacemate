-- PaceMate weekly roadmap foundation
-- 1-A draft only: do not apply directly to a remote database.
-- This migration is intentionally additive and preserves existing rows.

begin;

-- ---------------------------------------------------------------------------
-- A. Restore columns referenced by the current application.
-- ---------------------------------------------------------------------------
alter table public.student_profiles
  add column if not exists is_onboarded boolean not null default false;

alter table public.professor_availability
  add column if not exists specific_date date;

alter table public.student_courses
  add column if not exists offering_id uuid;

alter table public.chat_sessions
  add column if not exists offering_id uuid;

alter table public.escalations
  add column if not exists offering_id uuid;

alter table public.counseling_requests
  add column if not exists offering_id uuid;

-- ---------------------------------------------------------------------------
-- B. Academic term and offering identity.
-- ---------------------------------------------------------------------------
create table if not exists public.academic_terms (
  id uuid primary key default gen_random_uuid(),
  school_id uuid references public.schools(id) on delete set null,
  semester_label text not null,
  starts_on date not null,
  ends_on date not null,
  timezone text not null default 'Asia/Seoul',
  total_weeks integer not null default 15 check (total_weeks between 1 and 60),
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint academic_terms_date_order check (starts_on <= ends_on),
  constraint academic_terms_school_semester_key unique (school_id, semester_label)
);

create table if not exists public.course_offerings (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  professor_id uuid not null references public.professors(id) on delete restrict,
  term_id uuid not null references public.academic_terms(id) on delete restrict,
  section_label text,
  starts_on date,
  ends_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint course_offerings_date_order check (starts_on is null or ends_on is null or starts_on <= ends_on)
);

create unique index if not exists course_offerings_identity_idx
  on public.course_offerings(course_id, professor_id, term_id, coalesce(section_label, ''));

-- ---------------------------------------------------------------------------
-- C. Structured weekly syllabus content.
-- ---------------------------------------------------------------------------
create table if not exists public.course_weekly_plans (
  id uuid primary key default gen_random_uuid(),
  offering_id uuid not null references public.course_offerings(id) on delete cascade,
  week_number integer not null check (week_number between 1 and 60),
  title text,
  topic text,
  content text,
  learning_objectives jsonb not null default '[]'::jsonb,
  preview_guide jsonb,
  review_guide jsonb,
  assignment_json jsonb,
  source_syllabus_id uuid references public.syllabi(id) on delete set null,
  source_reference text,
  extraction_confidence numeric(5, 4) check (extraction_confidence is null or extraction_confidence between 0 and 1),
  review_required boolean not null default true,
  professor_confirmed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint course_weekly_plans_offering_week_key unique (offering_id, week_number)
);

-- ---------------------------------------------------------------------------
-- D. Student progress: aggregate course state and week-level state.
-- ---------------------------------------------------------------------------
create table if not exists public.student_course_progress (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  offering_id uuid not null references public.course_offerings(id) on delete cascade,
  last_completed_week integer check (last_completed_week is null or last_completed_week between 0 and 60),
  status text not null default 'not_started' check (status in ('not_started', 'in_progress', 'completed', 'needs_review')),
  last_activity_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint student_course_progress_identity_key unique (student_id, offering_id)
);

create table if not exists public.student_weekly_progress (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  offering_id uuid not null references public.course_offerings(id) on delete cascade,
  week_number integer not null check (week_number between 1 and 60),
  progress_status_override text check (progress_status_override is null or progress_status_override in ('not_started', 'in_progress', 'covered', 'needs_review', 'skipped')),
  difficulty_level integer check (difficulty_level is null or difficulty_level between 1 and 5),
  understanding_level integer check (understanding_level is null or understanding_level between 1 and 5),
  private_note text,
  shared_feedback text,
  share_feedback_with_professor boolean not null default false,
  use_private_note_for_ai boolean not null default false,
  guide_json jsonb,
  guide_version text,
  input_hash text,
  generated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint student_weekly_progress_identity_key unique (student_id, offering_id, week_number)
);

-- ---------------------------------------------------------------------------
-- E. Nullable offering links for legacy conversation/escalation records.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'student_courses_offering_id_fkey'
      and conrelid = 'public.student_courses'::regclass
  ) then
    alter table public.student_courses
      add constraint student_courses_offering_id_fkey
      foreign key (offering_id) references public.course_offerings(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'chat_sessions_offering_id_fkey'
      and conrelid = 'public.chat_sessions'::regclass
  ) then
    alter table public.chat_sessions
      add constraint chat_sessions_offering_id_fkey
      foreign key (offering_id) references public.course_offerings(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'escalations_offering_id_fkey'
      and conrelid = 'public.escalations'::regclass
  ) then
    alter table public.escalations
      add constraint escalations_offering_id_fkey
      foreign key (offering_id) references public.course_offerings(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'counseling_requests_offering_id_fkey'
      and conrelid = 'public.counseling_requests'::regclass
  ) then
    alter table public.counseling_requests
      add constraint counseling_requests_offering_id_fkey
      foreign key (offering_id) references public.course_offerings(id) on delete set null;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- F. Indexes and updated_at triggers.
-- ---------------------------------------------------------------------------
create index if not exists academic_terms_active_idx
  on public.academic_terms(is_active, starts_on);
create index if not exists course_offerings_term_idx
  on public.course_offerings(term_id, course_id);
create index if not exists course_offerings_professor_idx
  on public.course_offerings(professor_id, term_id);
create index if not exists course_weekly_plans_source_syllabus_idx
  on public.course_weekly_plans(source_syllabus_id);
create index if not exists student_course_progress_student_idx
  on public.student_course_progress(student_id, updated_at desc);
create index if not exists student_weekly_progress_student_idx
  on public.student_weekly_progress(student_id, offering_id, week_number);
create index if not exists student_courses_offering_idx
  on public.student_courses(offering_id);
create index if not exists chat_sessions_offering_idx
  on public.chat_sessions(offering_id);
create index if not exists escalations_offering_idx
  on public.escalations(offering_id);
create index if not exists counseling_requests_offering_idx
  on public.counseling_requests(offering_id);

drop trigger if exists academic_terms_set_updated_at on public.academic_terms;
create trigger academic_terms_set_updated_at
before update on public.academic_terms
for each row execute function public.set_updated_at();

drop trigger if exists course_offerings_set_updated_at on public.course_offerings;
create trigger course_offerings_set_updated_at
before update on public.course_offerings
for each row execute function public.set_updated_at();

drop trigger if exists course_weekly_plans_set_updated_at on public.course_weekly_plans;
create trigger course_weekly_plans_set_updated_at
before update on public.course_weekly_plans
for each row execute function public.set_updated_at();

drop trigger if exists student_course_progress_set_updated_at on public.student_course_progress;
create trigger student_course_progress_set_updated_at
before update on public.student_course_progress
for each row execute function public.set_updated_at();

drop trigger if exists student_weekly_progress_set_updated_at on public.student_weekly_progress;
create trigger student_weekly_progress_set_updated_at
before update on public.student_weekly_progress
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- G. RLS/GRANT baseline for the Supabase Auth transition.
-- Demo-cookie access remains server-only and is not represented by anon RLS.
-- ---------------------------------------------------------------------------
alter table public.academic_terms enable row level security;
alter table public.course_offerings enable row level security;
alter table public.course_weekly_plans enable row level security;
alter table public.student_course_progress enable row level security;
alter table public.student_weekly_progress enable row level security;

revoke all on public.academic_terms from anon;
revoke all on public.course_offerings from anon;
revoke all on public.course_weekly_plans from anon;
revoke all on public.student_course_progress from anon;
revoke all on public.student_weekly_progress from anon;

grant select on public.academic_terms to authenticated;
grant select on public.course_offerings, public.course_weekly_plans to authenticated;
grant select, insert, update on public.student_course_progress, public.student_weekly_progress to authenticated;

drop policy if exists "authenticated read academic terms" on public.academic_terms;
create policy "authenticated read academic terms"
on public.academic_terms for select to authenticated
using (true);

drop policy if exists "authenticated read course offerings" on public.course_offerings;
create policy "authenticated read course offerings"
on public.course_offerings for select to authenticated
using (
  exists (
    select 1 from public.student_courses sc
    where sc.offering_id = course_offerings.id
      and sc.student_id = (select auth.uid())
  )
  or exists (
    select 1 from public.professors p
    where p.id = course_offerings.professor_id
      and p.profile_id = (select auth.uid())
  )
);

drop policy if exists "authenticated read course weekly plans" on public.course_weekly_plans;
create policy "authenticated read course weekly plans"
on public.course_weekly_plans for select to authenticated
using (
  exists (
    select 1 from public.course_offerings co
    where co.id = course_weekly_plans.offering_id
      and (
        exists (select 1 from public.student_courses sc where sc.offering_id = co.id and sc.student_id = (select auth.uid()))
        or exists (select 1 from public.professors p where p.id = co.professor_id and p.profile_id = (select auth.uid()))
      )
  )
);

drop policy if exists "students manage own course progress" on public.student_course_progress;
create policy "students manage own course progress"
on public.student_course_progress for all to authenticated
using (student_id = (select auth.uid()))
with check (student_id = (select auth.uid()));

drop policy if exists "students manage own weekly progress" on public.student_weekly_progress;
create policy "students manage own weekly progress"
on public.student_weekly_progress for all to authenticated
using (student_id = (select auth.uid()))
with check (student_id = (select auth.uid()));

commit;
