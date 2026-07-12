create table if not exists public.professor_teaching_slots (
  id uuid primary key default gen_random_uuid(),
  professor_id uuid not null references public.professors(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  day_of_week int not null check (day_of_week between 0 and 6),
  period_label text not null,
  start_time time not null,
  end_time time not null,
  classroom text,
  course_type text,
  target_label text,
  semester_label text not null default '2026',
  created_at timestamptz not null default now(),
  constraint professor_teaching_slots_time_order check (start_time < end_time),
  unique (professor_id, course_id, day_of_week, start_time, classroom, semester_label)
);

create index if not exists professor_teaching_slots_professor_day_idx
  on public.professor_teaching_slots(professor_id, day_of_week, start_time);
create index if not exists professor_teaching_slots_course_id_idx
  on public.professor_teaching_slots(course_id);

alter table public.professor_teaching_slots enable row level security;

grant select on public.professor_teaching_slots to anon, authenticated;
grant select, insert, update, delete on public.professor_teaching_slots to anon;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'professor_teaching_slots'
      and policyname = 'public read professor teaching slots'
  ) then
    create policy "public read professor teaching slots"
      on public.professor_teaching_slots
      for select to anon, authenticated
      using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'professor_teaching_slots'
      and policyname = 'demo anon manage professor teaching slots'
  ) then
    create policy "demo anon manage professor teaching slots"
      on public.professor_teaching_slots
      for all to anon
      using (professor_id is not null and course_id is not null)
      with check (professor_id is not null and course_id is not null);
  end if;
end $$;

with seed_school as (
  insert into public.schools (name)
  values ('계명대학교')
  on conflict (name) do update set name = excluded.name
  returning id
),
seed_department as (
  insert into public.departments (school_id, name)
  select id, '법학과' from seed_school
  on conflict (school_id, name) do update set name = excluded.name
  returning id, school_id
),
seed_professor as (
  insert into public.professors (department_id, name, office, phone, email)
  select id, '박성은', '쉐턱관 227', '053-580-5423', 'zivilprozess_park@kmu.ac.kr'
  from seed_department
  on conflict do nothing
  returning id, department_id
),
professor_row as (
  select id, department_id from seed_professor
  union all
  select id, department_id
  from public.professors
  where email = 'zivilprozess_park@kmu.ac.kr'
  limit 1
),
course_rows as (
  insert into public.courses (school_id, department_id, code, name, credit, category, recommended_grade, description)
  select sd.school_id, sd.id, v.code, v.name, 3, v.category, v.grade, v.description
  from seed_department sd
  cross join (values
    ('44661-01', '부동산거래와건강한경제생활', '균형교양', null::int, '부동산 거래와 생활 경제를 법적 관점에서 이해하는 교양 수업입니다.'),
    ('12205-01', '담보물권법', '전공선택', 2, '담보물권의 법리와 실무 쟁점을 다루는 전공 수업입니다.'),
    ('21138-01', '민사소송법(1)', '전공선택', 3, '민사소송 절차의 기본 구조와 쟁점을 다루는 전공 수업입니다.')
  ) as v(code, name, category, grade, description)
  on conflict (school_id, code) do update set
    name = excluded.name,
    credit = excluded.credit,
    category = excluded.category,
    recommended_grade = excluded.recommended_grade,
    description = excluded.description
  returning id, code
),
linked_courses as (
  insert into public.course_professors (course_id, professor_id, semester_label)
  select c.id, p.id, '2026학년도'
  from course_rows c cross join professor_row p
  on conflict (course_id, professor_id, semester_label) do nothing
  returning id
),
slot_source as (
  select * from (values
    ('44661-01', 1, '3B', '10:30'::time, '11:00'::time, '봉222', '강의', '수강희망자'),
    ('44661-01', 1, '4A', '11:00'::time, '11:30'::time, '봉222', '강의', '수강희망자'),
    ('44661-01', 1, '4B', '11:30'::time, '12:00'::time, '봉222', '강의', '수강희망자'),
    ('12205-01', 1, '6B', '13:30'::time, '14:00'::time, '오409', '강의', '법학과 2년'),
    ('12205-01', 1, '7A', '14:00'::time, '14:30'::time, '오409', '강의', '법학과 2년'),
    ('12205-01', 1, '7B', '14:30'::time, '15:00'::time, '오409', '강의', '법학과 2년'),
    ('21138-01', 2, '2A', '09:00'::time, '09:30'::time, '쉐106', '강의', '법학과 3년'),
    ('21138-01', 2, '2B', '09:30'::time, '10:00'::time, '쉐106', '강의', '법학과 3년'),
    ('21138-01', 2, '3A', '10:00'::time, '10:30'::time, '쉐106', '강의', '법학과 3년'),
    ('12205-01', 3, '2A', '09:00'::time, '09:30'::time, '오409', '강의', '법학과 2년'),
    ('12205-01', 3, '2B', '09:30'::time, '10:00'::time, '오409', '강의', '법학과 2년'),
    ('12205-01', 3, '3A', '10:00'::time, '10:30'::time, '오409', '강의', '법학과 2년'),
    ('44661-01', 4, '6B', '13:30'::time, '14:00'::time, '봉222', '강의', '수강희망자'),
    ('44661-01', 4, '7A', '14:00'::time, '14:30'::time, '봉222', '강의', '수강희망자'),
    ('44661-01', 4, '7B', '14:30'::time, '15:00'::time, '봉222', '강의', '수강희망자'),
    ('21138-01', 4, '8A', '15:00'::time, '15:30'::time, '쉐106', '강의', '법학과 3년'),
    ('21138-01', 4, '8B', '15:30'::time, '16:00'::time, '쉐106', '강의', '법학과 3년'),
    ('21138-01', 4, '9A', '16:00'::time, '16:30'::time, '쉐106', '강의', '법학과 3년')
  ) as s(code, day_of_week, period_label, start_time, end_time, classroom, course_type, target_label)
)
insert into public.professor_teaching_slots (
  professor_id, course_id, day_of_week, period_label, start_time, end_time, classroom, course_type, target_label, semester_label
)
select p.id, c.id, s.day_of_week, s.period_label, s.start_time, s.end_time, s.classroom, s.course_type, s.target_label, '2026학년도'
from slot_source s
join public.courses c on c.code = s.code
cross join professor_row p
on conflict (professor_id, course_id, day_of_week, start_time, classroom, semester_label) do update set
  period_label = excluded.period_label,
  end_time = excluded.end_time,
  course_type = excluded.course_type,
  target_label = excluded.target_label;;
