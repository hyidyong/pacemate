begin;

-- The deployed application already writes these legacy columns. Declare them
-- here as well so the backfill is safe on clean databases and old snapshots.
alter table public.student_courses
  add column if not exists schedule_day text,
  add column if not exists start_time time,
  add column if not exists end_time time,
  add column if not exists classroom text,
  add column if not exists semester_label text default '2026-2',
  add column if not exists is_favorite boolean not null default false,
  add column if not exists updated_at timestamptz not null default now();

create table public.student_course_schedule_slots (
  id uuid primary key default gen_random_uuid(),
  student_course_id uuid not null references public.student_courses(id) on delete cascade,
  day_of_week text not null check (day_of_week in (U&'\C6D4', U&'\D654', U&'\C218', U&'\BAA9', U&'\AE08', U&'\D1A0', U&'\C77C')),
  start_time time not null,
  end_time time not null,
  classroom text,
  source text not null default 'manual' check (source in ('syllabus', 'professor', 'manual', 'legacy')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint student_course_schedule_slots_time_order check (start_time < end_time),
  unique (student_course_id, day_of_week, start_time, end_time)
);

create table public.student_custom_courses (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (btrim(title) <> ''),
  color text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.student_custom_course_schedule_slots (
  id uuid primary key default gen_random_uuid(),
  student_custom_course_id uuid not null references public.student_custom_courses(id) on delete cascade,
  day_of_week text not null check (day_of_week in (U&'\C6D4', U&'\D654', U&'\C218', U&'\BAA9', U&'\AE08', U&'\D1A0', U&'\C77C')),
  start_time time not null,
  end_time time not null,
  classroom text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint student_custom_course_schedule_slots_time_order check (start_time < end_time),
  unique (student_custom_course_id, day_of_week, start_time, end_time)
);

create index if not exists student_course_schedule_slots_course_day_time_idx
  on public.student_course_schedule_slots(student_course_id, day_of_week, start_time);
create index if not exists student_custom_courses_student_updated_idx
  on public.student_custom_courses(student_id, updated_at desc);
create index if not exists student_custom_course_schedule_slots_course_day_time_idx
  on public.student_custom_course_schedule_slots(student_custom_course_id, day_of_week, start_time);

-- Guard the backfill for local schema snapshots that predate the legacy columns.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'student_courses'
      and column_name in ('schedule_day', 'start_time', 'end_time', 'classroom')
    group by table_schema, table_name
    having count(*) = 4
  ) then
    execute $backfill$
      insert into public.student_course_schedule_slots (
        student_course_id, day_of_week, start_time, end_time, classroom, source
      )
      select sc.id, sc.schedule_day, sc.start_time, sc.end_time, sc.classroom, 'legacy'
      from public.student_courses sc
      where sc.schedule_day in (U&'\C6D4', U&'\D654', U&'\C218', U&'\BAA9', U&'\AE08', U&'\D1A0', U&'\C77C')
        and sc.start_time is not null
        and sc.end_time is not null
        and sc.start_time < sc.end_time
      on conflict (student_course_id, day_of_week, start_time, end_time) do nothing
    $backfill$;
  end if;
end
$$;

create trigger student_course_schedule_slots_set_updated_at
before update on public.student_course_schedule_slots
for each row execute function public.set_updated_at();

create trigger student_custom_courses_set_updated_at
before update on public.student_custom_courses
for each row execute function public.set_updated_at();

create trigger student_custom_course_schedule_slots_set_updated_at
before update on public.student_custom_course_schedule_slots
for each row execute function public.set_updated_at();

alter table public.student_course_schedule_slots enable row level security;
alter table public.student_custom_courses enable row level security;
alter table public.student_custom_course_schedule_slots enable row level security;

revoke all on public.student_course_schedule_slots,
  public.student_custom_courses,
  public.student_custom_course_schedule_slots
  from public, anon;

grant select, insert, update, delete on public.student_course_schedule_slots,
  public.student_custom_courses,
  public.student_custom_course_schedule_slots
  to authenticated;

create policy "students manage own course schedule slots"
  on public.student_course_schedule_slots for all to authenticated
  using (exists (
    select 1
    from public.student_courses sc
    join public.profiles p on p.id = sc.student_id
    where sc.id = student_course_schedule_slots.student_course_id
      and p.auth_user_id = (select auth.uid())
  ))
  with check (exists (
    select 1
    from public.student_courses sc
    join public.profiles p on p.id = sc.student_id
    where sc.id = student_course_schedule_slots.student_course_id
      and p.auth_user_id = (select auth.uid())
  ));

create policy "students manage own custom courses"
  on public.student_custom_courses for all to authenticated
  using (exists (
    select 1
    from public.profiles p
    where p.id = student_custom_courses.student_id
      and p.auth_user_id = (select auth.uid())
  ))
  with check (exists (
    select 1
    from public.profiles p
    where p.id = student_custom_courses.student_id
      and p.auth_user_id = (select auth.uid())
  ));

create policy "students manage own custom course schedule slots"
  on public.student_custom_course_schedule_slots for all to authenticated
  using (exists (
    select 1
    from public.student_custom_courses scc
    join public.profiles p on p.id = scc.student_id
    where scc.id = student_custom_course_schedule_slots.student_custom_course_id
      and p.auth_user_id = (select auth.uid())
  ))
  with check (exists (
    select 1
    from public.student_custom_courses scc
    join public.profiles p on p.id = scc.student_id
    where scc.id = student_custom_course_schedule_slots.student_custom_course_id
      and p.auth_user_id = (select auth.uid())
  ));

-- A PostgreSQL function executes as one transaction. Callers never observe a
-- course with its old slots deleted but replacement slots missing.
create or replace function public.replace_student_course_schedule_slots(
  p_student_course_id uuid,
  p_slots jsonb
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if jsonb_typeof(p_slots) <> 'array' then
    raise exception 'schedule slots must be a JSON array';
  end if;

  perform 1 from public.student_courses where id = p_student_course_id;
  if not found then
    raise exception 'student course not found';
  end if;

  delete from public.student_course_schedule_slots
  where student_course_id = p_student_course_id;

  insert into public.student_course_schedule_slots (
    student_course_id, day_of_week, start_time, end_time, classroom, source
  )
  select
    p_student_course_id,
    slot.day_of_week,
    slot.start_time,
    slot.end_time,
    nullif(btrim(slot.classroom), ''),
    slot.source
  from jsonb_to_recordset(p_slots) as slot(
    day_of_week text,
    start_time time,
    end_time time,
    classroom text,
    source text
  );
end;
$$;

revoke all on function public.replace_student_course_schedule_slots(uuid, jsonb) from public;
grant execute on function public.replace_student_course_schedule_slots(uuid, jsonb) to authenticated;

commit;
