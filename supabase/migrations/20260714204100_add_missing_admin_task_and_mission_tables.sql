-- The professor_admin_tasks and student_mission_progress tables were created
-- directly on the live database (they exist only in supabase/schema.sql), so a
-- fresh `supabase db reset` fails when the later hardening migration
-- (20260714204203) runs `alter table public.professor_admin_tasks ...` against
-- a table that no migration ever created. This migration backfills both table
-- definitions; every statement is guarded so it is a no-op on databases that
-- already have them.

create table if not exists public.professor_admin_tasks (
  id uuid primary key default gen_random_uuid(),
  professor_id uuid not null references public.professors(id) on delete cascade,
  title text not null,
  day_of_week int not null check (day_of_week between 0 and 6),
  start_time time not null,
  end_time time not null,
  created_at timestamptz not null default now(),
  constraint professor_admin_tasks_time_order check (start_time < end_time)
);

create index if not exists professor_admin_tasks_professor_id_idx
  on public.professor_admin_tasks(professor_id);

-- RLS, grants, and policies for professor_admin_tasks are applied by
-- 20260714204203_harden_professor_admin_tasks_access.sql.

create table if not exists public.student_mission_progress (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  week_number int not null,
  is_completed boolean not null default false,
  actual_progress_feedback text,
  calibrated_by_ai boolean not null default false,
  calibrated_mission_json jsonb,
  updated_at timestamptz not null default now(),
  unique (student_id, course_id, week_number)
);

alter table public.student_mission_progress enable row level security;

grant select, insert, update, delete on public.student_mission_progress to anon, authenticated;

drop policy if exists "demo manage student_mission_progress" on public.student_mission_progress;
create policy "demo manage student_mission_progress"
  on public.student_mission_progress
  for all
  to anon, authenticated
  using (true)
  with check (true);
