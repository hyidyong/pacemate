-- Syllabus ingestion and normalized study data.
-- Additive only: preserves the existing syllabi/course_weekly_plans relationship.

begin;

alter table public.syllabi
  add column if not exists original_filename text,
  add column if not exists storage_path text,
  add column if not exists mime_type text,
  add column if not exists parsing_status text not null default 'pending',
  add column if not exists parsing_error text,
  add column if not exists raw_extracted_text text,
  add column if not exists parsed_data jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'syllabi_parsing_status_check'
      and conrelid = 'public.syllabi'::regclass
  ) then
    alter table public.syllabi
      add constraint syllabi_parsing_status_check
      check (parsing_status in ('pending', 'processing', 'completed', 'failed'));
  end if;
end
$$;

create unique index if not exists syllabi_storage_path_idx
  on public.syllabi(storage_path)
  where storage_path is not null;
create index if not exists syllabi_course_created_idx
  on public.syllabi(course_id, created_at desc);

create table if not exists public.course_schedules (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  day_of_week text not null check (day_of_week in ('월', '화', '수', '목', '금', '토', '일')),
  start_time time not null,
  end_time time not null,
  classroom text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint course_schedules_time_order check (start_time < end_time),
  unique (course_id, day_of_week, start_time, end_time)
);

create table if not exists public.course_assessments (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  assessment_type text not null check (assessment_type in ('attendance', 'midterm', 'final', 'assignment', 'quiz', 'presentation', 'other')),
  title text not null,
  weight_percent numeric(5, 2) check (weight_percent is null or (weight_percent >= 0 and weight_percent <= 100)),
  score numeric(6, 2),
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.study_roadmaps (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  offering_id uuid references public.course_offerings(id) on delete set null,
  title text not null,
  start_date date,
  end_date date,
  status text not null default 'draft' check (status in ('draft', 'active', 'completed', 'archived')),
  generation_source text not null default 'syllabus_generated' check (generation_source in ('manual', 'syllabus_generated', 'ai_generated')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.study_tasks (
  id uuid primary key default gen_random_uuid(),
  roadmap_id uuid not null references public.study_roadmaps(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  course_week_id uuid references public.course_weekly_plans(id) on delete set null,
  student_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  description text,
  task_type text not null default 'study' check (task_type in ('study', 'review', 'assignment', 'exam_prep', 'other')),
  due_date date,
  estimated_minutes integer check (estimated_minutes is null or estimated_minutes > 0),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  status text not null default 'todo' check (status in ('todo', 'in_progress', 'done', 'skipped')),
  source text not null default 'syllabus_generated' check (source in ('manual', 'syllabus_generated', 'ai_generated')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists study_roadmaps_active_student_course_idx
  on public.study_roadmaps(student_id, course_id)
  where status in ('draft', 'active');
create index if not exists study_tasks_student_due_idx
  on public.study_tasks(student_id, due_date, status);
create index if not exists study_tasks_roadmap_idx
  on public.study_tasks(roadmap_id, due_date);

do $$
declare
  table_name text;
begin
  foreach table_name in array array['syllabi', 'course_schedules', 'course_assessments', 'study_roadmaps', 'study_tasks']
  loop
    if not exists (
      select 1 from pg_trigger
      where tgname = table_name || '_set_updated_at'
        and tgrelid = ('public.' || table_name)::regclass
        and not tgisinternal
    ) then
      execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', table_name || '_set_updated_at', table_name);
    end if;
  end loop;
end
$$;

alter table public.course_schedules enable row level security;
alter table public.course_assessments enable row level security;
alter table public.study_roadmaps enable row level security;
alter table public.study_tasks enable row level security;

grant select on public.course_schedules, public.course_assessments to authenticated;
grant select, insert, update, delete on public.study_roadmaps, public.study_tasks to authenticated;

create policy "students read schedules for assigned courses"
  on public.course_schedules for select to authenticated
  using (exists (
    select 1 from public.student_courses sc
    join public.profiles p on p.id = sc.student_id
    where sc.course_id = course_schedules.course_id
      and p.auth_user_id = (select auth.uid())
  ));

create policy "students read assessments for assigned courses"
  on public.course_assessments for select to authenticated
  using (exists (
    select 1 from public.student_courses sc
    join public.profiles p on p.id = sc.student_id
    where sc.course_id = course_assessments.course_id
      and p.auth_user_id = (select auth.uid())
  ));

create policy "students manage own study roadmaps"
  on public.study_roadmaps for all to authenticated
  using (exists (
    select 1 from public.profiles p
    where p.id = study_roadmaps.student_id and p.auth_user_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.profiles p
    where p.id = study_roadmaps.student_id and p.auth_user_id = (select auth.uid())
  ));

create policy "students manage own study tasks"
  on public.study_tasks for all to authenticated
  using (exists (
    select 1 from public.profiles p
    where p.id = study_tasks.student_id and p.auth_user_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.profiles p
    where p.id = study_tasks.student_id and p.auth_user_id = (select auth.uid())
  ));

insert into storage.buckets (id, name, public)
values ('syllabus-files', 'syllabus-files', false)
on conflict (id) do update set public = false;

create policy "authenticated users upload own syllabus files"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'syllabus-files'
    and (storage.foldername(name))[1] = (
      select p.id::text from public.profiles p where p.auth_user_id = (select auth.uid())
    )
  );

create policy "authenticated users read own syllabus files"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'syllabus-files'
    and (storage.foldername(name))[1] = (
      select p.id::text from public.profiles p where p.auth_user_id = (select auth.uid())
    )
  );

commit;
