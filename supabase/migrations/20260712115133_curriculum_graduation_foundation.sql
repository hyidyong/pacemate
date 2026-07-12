-- PaceMate curriculum and graduation foundation (1-D-2A draft)
-- Generated with Supabase CLI `migration new curriculum_graduation_foundation`.
-- Review-only in this stage: do not apply to a database.
-- Additive only: no existing table changes, data writes, seed data, or policies.

begin;

-- ---------------------------------------------------------------------------
-- A. Curriculum source versions
-- ---------------------------------------------------------------------------
create table if not exists public.curriculum_versions (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete restrict,
  department_id uuid not null references public.departments(id) on delete restrict,
  version_key text not null,
  academic_year integer,
  version_label text not null,
  admission_year_from integer not null,
  admission_year_to integer,
  status text not null default 'draft'
    check (status in ('draft', 'active', 'archived')),
  source_title text not null,
  source_file text not null,
  source_academic_year integer,
  source_edition text,
  publication_date date,
  source_verified boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint curriculum_versions_year_order
    check (admission_year_from between 1900 and 2200
      and (admission_year_to is null or admission_year_to between admission_year_from and 2200)),
  constraint curriculum_versions_academic_year_range
    check (academic_year is null or academic_year between 1900 and 2200),
  constraint curriculum_versions_source_year_range
    check (source_academic_year is null or source_academic_year between 1900 and 2200)
);

create unique index if not exists curriculum_versions_identity_idx
  on public.curriculum_versions (
    school_id,
    department_id,
    version_key,
    admission_year_from,
    coalesce(admission_year_to, 9999)
  );

create unique index if not exists curriculum_versions_active_range_idx
  on public.curriculum_versions (
    department_id,
    admission_year_from,
    coalesce(admission_year_to, 9999)
  ) where status = 'active';

-- ---------------------------------------------------------------------------
-- B. Version-specific course placement
-- ---------------------------------------------------------------------------
create table if not exists public.curriculum_courses (
  id uuid primary key default gen_random_uuid(),
  curriculum_version_id uuid not null references public.curriculum_versions(id) on delete cascade,
  course_id uuid references public.courses(id) on delete restrict,
  source_course_name text not null,
  source_course_code text,
  credits integer check (credits is null or credits >= 0),
  requirement_type text not null check (requirement_type in (
    'major_required',
    'major_elective',
    'major_recognized',
    'former_major_foundation',
    'common_general',
    'balanced_general',
    'general_elective',
    'teaching',
    'graduation_requirement',
    'other'
  )),
  recommended_grade integer check (recommended_grade is null or recommended_grade between 1 and 4),
  recommended_semester integer check (recommended_semester is null or recommended_semester between 1 and 2),
  curriculum_level text,
  is_required boolean not null default false,
  source_page integer check (source_page is null or source_page > 0),
  sort_order integer not null default 0 check (sort_order >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists curriculum_courses_identity_idx
  on public.curriculum_courses (
    curriculum_version_id,
    source_course_name,
    requirement_type,
    coalesce(recommended_grade, 0),
    coalesce(recommended_semester, 0)
  );

-- ---------------------------------------------------------------------------
-- C. Graduation rules and scoped exceptions
-- ---------------------------------------------------------------------------
create table if not exists public.curriculum_requirements (
  id uuid primary key default gen_random_uuid(),
  curriculum_version_id uuid not null references public.curriculum_versions(id) on delete cascade,
  requirement_code text not null,
  requirement_type text not null check (requirement_type in (
    'total_credits',
    'major_credits',
    'required_courses',
    'common_general_credits',
    'balanced_general_credits',
    'double_major_credits',
    'minor_credits',
    'language',
    'capstone',
    'graduation_exam',
    'teaching',
    'other'
  )),
  title text not null,
  minimum_credits integer check (minimum_credits is null or minimum_credits >= 0),
  minimum_course_count integer check (minimum_course_count is null or minimum_course_count >= 0),
  must_complete_all boolean not null default false,
  rule_definition jsonb not null default '{}'::jsonb,
  source_page integer check (source_page is null or source_page > 0),
  is_required boolean not null default true,
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint curriculum_requirements_rule_payload_object
    check (jsonb_typeof(rule_definition) = 'object')
);

create unique index if not exists curriculum_requirements_code_idx
  on public.curriculum_requirements(curriculum_version_id, requirement_code);

create table if not exists public.curriculum_requirement_exceptions (
  id uuid primary key default gen_random_uuid(),
  curriculum_version_id uuid not null references public.curriculum_versions(id) on delete cascade,
  exception_type text not null check (exception_type in (
    'transfer_student',
    'department_transfer',
    'readmission',
    'double_major',
    'minor',
    'department_merger',
    'department_split',
    'international_student',
    'other'
  )),
  title text not null,
  condition_definition jsonb not null default '{}'::jsonb,
  override_definition jsonb not null default '{}'::jsonb,
  priority integer not null default 0 check (priority >= 0),
  requires_manual_review boolean not null default true,
  source_page integer check (source_page is null or source_page > 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint curriculum_requirement_exceptions_condition_object
    check (jsonb_typeof(condition_definition) = 'object'),
  constraint curriculum_requirement_exceptions_override_object
    check (jsonb_typeof(override_definition) = 'object')
);

create unique index if not exists curriculum_requirement_exceptions_identity_idx
  on public.curriculum_requirement_exceptions(curriculum_version_id, exception_type, title);

-- ---------------------------------------------------------------------------
-- D. Course equivalency evidence
-- ---------------------------------------------------------------------------
create table if not exists public.course_equivalencies (
  id uuid primary key default gen_random_uuid(),
  curriculum_version_id uuid references public.curriculum_versions(id) on delete cascade,
  source_course_id uuid references public.courses(id) on delete restrict,
  target_course_id uuid references public.courses(id) on delete restrict,
  source_course_name text not null,
  target_course_name text not null,
  source_course_code text,
  target_course_code text,
  equivalence_type text not null check (equivalence_type in (
    'same_course',
    'course_code_change',
    'substitution',
    'transfer_recognition',
    'partial_recognition'
  )),
  condition_definition jsonb not null default '{}'::jsonb,
  source_page integer check (source_page is null or source_page > 0),
  verification_status text not null default 'unresolved'
    check (verification_status in ('unresolved', 'verified', 'rejected')),
  verified_by uuid references public.profiles(id) on delete restrict,
  verified_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint course_equivalencies_condition_object
    check (jsonb_typeof(condition_definition) = 'object'),
  constraint course_equivalencies_not_self
    check (source_course_id is null or target_course_id is null or source_course_id <> target_course_id),
  constraint course_equivalencies_verified_fields_check
    check ((verification_status = 'verified' and verified_by is not null and verified_at is not null)
      or (verification_status <> 'verified' and verified_by is null and verified_at is null))
);

create unique index if not exists course_equivalencies_identity_idx
  on public.course_equivalencies (
    coalesce(curriculum_version_id, '00000000-0000-0000-0000-000000000000'::uuid),
    source_course_name,
    target_course_name,
    equivalence_type
  );

-- ---------------------------------------------------------------------------
-- E. Career tracks and recommended course sequences
-- ---------------------------------------------------------------------------
create table if not exists public.career_tracks (
  id uuid primary key default gen_random_uuid(),
  curriculum_version_id uuid not null references public.curriculum_versions(id) on delete cascade,
  track_code text not null,
  track_name text not null,
  category text not null,
  description text,
  source_page integer check (source_page is null or source_page > 0),
  sort_order integer not null default 0 check (sort_order >= 0),
  status text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists career_tracks_identity_idx
  on public.career_tracks(curriculum_version_id, track_code);

create table if not exists public.career_track_courses (
  id uuid primary key default gen_random_uuid(),
  career_track_id uuid not null references public.career_tracks(id) on delete cascade,
  curriculum_course_id uuid references public.curriculum_courses(id) on delete restrict,
  course_id uuid references public.courses(id) on delete restrict,
  recommended_grade integer check (recommended_grade is null or recommended_grade between 1 and 4),
  recommended_semester integer check (recommended_semester is null or recommended_semester between 1 and 2),
  recommended_stage text,
  priority integer not null default 0 check (priority >= 0),
  is_required boolean not null default false,
  recommendation_type text not null default 'recommended_sequence'
    check (recommendation_type in ('recommended_sequence', 'recommended_course', 'exam_reference')),
  explicitly_stated boolean not null default false,
  source_page integer check (source_page is null or source_page > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint career_track_courses_target_check
    check (curriculum_course_id is not null or course_id is not null)
);

create unique index if not exists career_track_courses_identity_idx
  on public.career_track_courses(
    career_track_id,
    coalesce(curriculum_course_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(course_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(recommended_grade, 0),
    coalesce(recommended_semester, 0)
  );

-- ---------------------------------------------------------------------------
-- F. Student assignment and verified course records
-- ---------------------------------------------------------------------------
create table if not exists public.student_curriculum_assignments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  curriculum_version_id uuid not null references public.curriculum_versions(id) on delete restrict,
  assignment_type text not null check (assignment_type in (
    'primary_major',
    'double_major',
    'minor',
    'transferred_major'
  )),
  status text not null default 'manual_review'
    check (status in ('active', 'superseded', 'manual_review')),
  admission_year integer check (admission_year is null or admission_year between 1900 and 2200),
  transfer_year integer check (transfer_year is null or transfer_year between 1900 and 2200),
  readmission_year integer check (readmission_year is null or readmission_year between 1900 and 2200),
  assignment_reason text not null,
  requires_manual_review boolean not null default true,
  resolved_by uuid references public.profiles(id) on delete restrict,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists student_curriculum_assignments_active_idx
  on public.student_curriculum_assignments(student_id, assignment_type)
  where status = 'active';

create index if not exists student_curriculum_assignments_student_idx
  on public.student_curriculum_assignments(student_id, status);

create table if not exists public.student_course_records (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  curriculum_course_id uuid not null references public.curriculum_courses(id) on delete restrict,
  status text not null check (status in ('completed', 'recognized')),
  credits_earned integer check (credits_earned is null or credits_earned >= 0),
  completed_term text,
  grade text,
  recognition_source text,
  entry_source text not null check (entry_source in (
    'onboarding_self_report',
    'manual_admin',
    'school_import',
    'system_migration'
  )),
  is_verified boolean not null default false,
  verified_by uuid references public.profiles(id) on delete restrict,
  verified_at timestamptz,
  source_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint student_course_records_verified_by_check
    check ((is_verified = false and verified_by is null and verified_at is null)
      or (is_verified = true and verified_by is not null and verified_at is not null))
);

create unique index if not exists student_course_records_identity_idx
  on public.student_course_records(student_id, curriculum_course_id);

create index if not exists student_course_records_student_idx
  on public.student_course_records(student_id, is_verified);

-- ---------------------------------------------------------------------------
-- G. Foreign-key and query indexes
-- ---------------------------------------------------------------------------
create index if not exists curriculum_versions_school_idx
  on public.curriculum_versions(school_id);
create index if not exists curriculum_versions_department_idx
  on public.curriculum_versions(department_id, status);
create index if not exists curriculum_courses_version_idx
  on public.curriculum_courses(curriculum_version_id, sort_order);
create index if not exists curriculum_courses_course_idx
  on public.curriculum_courses(course_id);
create index if not exists curriculum_requirements_version_idx
  on public.curriculum_requirements(curriculum_version_id, sort_order);
create index if not exists curriculum_requirement_exceptions_version_idx
  on public.curriculum_requirement_exceptions(curriculum_version_id, priority);
create index if not exists course_equivalencies_source_idx
  on public.course_equivalencies(source_course_id);
create index if not exists course_equivalencies_target_idx
  on public.course_equivalencies(target_course_id);
create index if not exists course_equivalencies_version_idx
  on public.course_equivalencies(curriculum_version_id);
create index if not exists course_equivalencies_verified_by_idx
  on public.course_equivalencies(verified_by);
create index if not exists career_tracks_version_idx
  on public.career_tracks(curriculum_version_id, sort_order);
create index if not exists career_track_courses_track_idx
  on public.career_track_courses(career_track_id, priority);
create index if not exists career_track_courses_curriculum_course_idx
  on public.career_track_courses(curriculum_course_id);
create index if not exists career_track_courses_course_idx
  on public.career_track_courses(course_id);
create index if not exists student_curriculum_assignments_version_idx
  on public.student_curriculum_assignments(curriculum_version_id);
create index if not exists student_curriculum_assignments_resolved_by_idx
  on public.student_curriculum_assignments(resolved_by);
create index if not exists student_course_records_curriculum_course_idx
  on public.student_course_records(curriculum_course_id);
create index if not exists student_course_records_verified_by_idx
  on public.student_course_records(verified_by);

-- ---------------------------------------------------------------------------
-- H. Server-only RLS baseline
-- ---------------------------------------------------------------------------
alter table public.curriculum_versions enable row level security;
alter table public.curriculum_courses enable row level security;
alter table public.curriculum_requirements enable row level security;
alter table public.curriculum_requirement_exceptions enable row level security;
alter table public.course_equivalencies enable row level security;
alter table public.career_tracks enable row level security;
alter table public.career_track_courses enable row level security;
alter table public.student_curriculum_assignments enable row level security;
alter table public.student_course_records enable row level security;

revoke all on public.curriculum_versions,
  public.curriculum_courses,
  public.curriculum_requirements,
  public.curriculum_requirement_exceptions,
  public.course_equivalencies,
  public.career_tracks,
  public.career_track_courses,
  public.student_curriculum_assignments,
  public.student_course_records
  from public, anon, authenticated;

-- Use the already reviewed public.set_updated_at() helper when present.
do $$
declare
  table_name text;
begin
  if to_regprocedure('public.set_updated_at()') is null then
    raise exception 'Required helper public.set_updated_at() is missing';
  end if;

  foreach table_name in array array[
    'curriculum_versions',
    'curriculum_courses',
    'curriculum_requirements',
    'curriculum_requirement_exceptions',
    'course_equivalencies',
    'career_tracks',
    'career_track_courses',
    'student_curriculum_assignments',
    'student_course_records'
  ] loop
    if not exists (
        select 1 from pg_trigger
        where tgname = table_name || '_set_updated_at'
          and tgrelid = ('public.' || table_name)::regclass
          and not tgisinternal
      ) then
      execute format(
        'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
        table_name || '_set_updated_at', table_name
      );
    end if;
  end loop;
end
$$;

commit;
