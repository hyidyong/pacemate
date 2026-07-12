create extension if not exists pgcrypto;

create type public.user_role as enum ('student', 'professor', 'assistant', 'admin');
create type public.student_type as enum ('freshman', 'transfer', 'cross_major', 'double_major', 'current_student');
create type public.course_status as enum ('completed', 'interested', 'recommended');
create type public.post_status as enum ('active', 'hidden', 'deleted');
create type public.reaction_type as enum ('like', 'scrap');
create type public.report_status as enum ('pending', 'reviewed', 'dismissed', 'resolved');
create type public.escalation_status as enum ('pending', 'assigned', 'answered', 'closed');
create type public.counseling_status as enum ('pending', 'approved', 'rejected', 'cancelled');
create type public.chat_role as enum ('user', 'assistant', 'system');

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.set_updated_at() from public;
revoke all on function public.set_updated_at() from anon;
revoke all on function public.set_updated_at() from authenticated;

create table public.schools (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

create table public.departments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (school_id, name)
);

create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  identifier text not null unique,
  name text not null,
  role public.user_role not null default 'student',
  school_id uuid references public.schools(id),
  department_id uuid references public.departments(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.student_profiles (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references public.profiles(id) on delete cascade,
  user_types public.student_type[] not null default '{}',
  grade int check (grade between 1 and 6),
  semester int check (semester between 1 and 2),
  target_career text,
  interests text[] not null default '{}',
  weak_basics text[] not null default '{}',
  completed_courses_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.professors (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete set null,
  department_id uuid references public.departments(id),
  name text not null,
  office text,
  phone text,
  email text,
  bio text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.courses (
  id uuid primary key default gen_random_uuid(),
  school_id uuid references public.schools(id),
  department_id uuid references public.departments(id),
  code text not null,
  name text not null,
  credit int not null check (credit > 0),
  category text,
  recommended_grade int check (recommended_grade between 1 and 6),
  description text,
  prerequisite_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, code)
);

create table public.course_professors (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  professor_id uuid not null references public.professors(id) on delete cascade,
  semester_label text,
  created_at timestamptz not null default now(),
  unique (course_id, professor_id, semester_label)
);

create table public.student_courses (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  status public.course_status not null,
  source_text text,
  created_at timestamptz not null default now(),
  unique (student_id, course_id, status)
);

create table public.syllabi (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  file_url text,
  parsed_text text,
  source_name text,
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.notices (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  content text not null,
  category text,
  file_url text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.faqs (
  id uuid primary key default gen_random_uuid(),
  question text not null,
  answer text not null,
  category text,
  course_id uuid references public.courses(id) on delete set null,
  professor_id uuid references public.professors(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.roadmap_requests (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  input_json jsonb not null,
  created_at timestamptz not null default now()
);

create table public.roadmap_results (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.roadmap_requests(id) on delete cascade,
  result_json jsonb not null,
  source_summary text,
  created_at timestamptz not null default now()
);

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid references public.profiles(id) on delete set null,
  category text not null,
  title text not null,
  content text not null,
  course_id uuid references public.courses(id) on delete set null,
  status public.post_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete set null,
  content text not null,
  status public.post_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.post_reactions (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  type public.reaction_type not null,
  created_at timestamptz not null default now(),
  unique (post_id, user_id, type)
);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  target_type text not null,
  target_id uuid not null,
  reporter_id uuid references public.profiles(id) on delete set null,
  reason text not null,
  status public.report_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (target_type, target_id, reporter_id)
);

create table public.course_reviews (
  id uuid primary key default gen_random_uuid(),
  course_id uuid references public.courses(id) on delete set null,
  author_id uuid references public.profiles(id) on delete set null,
  difficulty int check (difficulty between 1 and 5),
  workload int check (workload between 1 and 5),
  grading_style text,
  team_project boolean,
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.chat_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  title text not null default '새 질문',
  created_at timestamptz not null default now()
);

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.chat_sessions(id) on delete cascade,
  role public.chat_role not null,
  content text not null,
  source_json jsonb,
  confidence numeric(4, 3) check (confidence between 0 and 1),
  created_at timestamptz not null default now()
);

create table public.escalations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  assigned_to uuid references public.profiles(id) on delete set null,
  source_message_id uuid references public.chat_messages(id) on delete set null,
  category text not null,
  question text not null,
  status public.escalation_status not null default 'pending',
  answer text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table public.professor_availability (
  id uuid primary key default gen_random_uuid(),
  professor_id uuid not null references public.professors(id) on delete cascade,
  day_of_week int not null check (day_of_week between 0 and 6),
  start_time time not null,
  end_time time not null,
  slot_minutes int not null default 30 check (slot_minutes in (10, 15, 20, 30, 60)),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint professor_availability_time_order check (start_time < end_time)
);

create table public.counseling_requests (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  professor_id uuid not null references public.professors(id) on delete cascade,
  requested_start timestamptz not null,
  requested_end timestamptz not null,
  topic text not null,
  status public.counseling_status not null default 'pending',
  professor_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint counseling_requests_time_order check (requested_start < requested_end)
);

create unique index counseling_requests_confirmed_slot_idx
  on public.counseling_requests (professor_id, requested_start, requested_end)
  where status in ('pending', 'approved');

create index courses_department_id_idx on public.courses(department_id);
create index posts_course_id_idx on public.posts(course_id);
create index posts_category_created_at_idx on public.posts(category, created_at desc);
create index comments_post_id_created_at_idx on public.comments(post_id, created_at);
create index course_reviews_course_id_idx on public.course_reviews(course_id);
create index chat_messages_session_id_created_at_idx on public.chat_messages(session_id, created_at);
create index escalations_status_created_at_idx on public.escalations(status, created_at);
create index counseling_requests_professor_status_idx on public.counseling_requests(professor_id, status);

create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();
create trigger student_profiles_set_updated_at before update on public.student_profiles
for each row execute function public.set_updated_at();
create trigger professors_set_updated_at before update on public.professors
for each row execute function public.set_updated_at();
create trigger courses_set_updated_at before update on public.courses
for each row execute function public.set_updated_at();
create trigger notices_set_updated_at before update on public.notices
for each row execute function public.set_updated_at();
create trigger faqs_set_updated_at before update on public.faqs
for each row execute function public.set_updated_at();
create trigger posts_set_updated_at before update on public.posts
for each row execute function public.set_updated_at();
create trigger comments_set_updated_at before update on public.comments
for each row execute function public.set_updated_at();
create trigger reports_set_updated_at before update on public.reports
for each row execute function public.set_updated_at();
create trigger course_reviews_set_updated_at before update on public.course_reviews
for each row execute function public.set_updated_at();
create trigger counseling_requests_set_updated_at before update on public.counseling_requests
for each row execute function public.set_updated_at();

alter table public.schools enable row level security;
alter table public.departments enable row level security;
alter table public.profiles enable row level security;
alter table public.student_profiles enable row level security;
alter table public.professors enable row level security;
alter table public.courses enable row level security;
alter table public.course_professors enable row level security;
alter table public.student_courses enable row level security;
alter table public.syllabi enable row level security;
alter table public.notices enable row level security;
alter table public.faqs enable row level security;
alter table public.roadmap_requests enable row level security;
alter table public.roadmap_results enable row level security;
alter table public.posts enable row level security;
alter table public.comments enable row level security;
alter table public.post_reactions enable row level security;
alter table public.reports enable row level security;
alter table public.course_reviews enable row level security;
alter table public.chat_sessions enable row level security;
alter table public.chat_messages enable row level security;
alter table public.escalations enable row level security;
alter table public.professor_availability enable row level security;
alter table public.counseling_requests enable row level security;

grant usage on schema public to anon, authenticated;
grant select on public.schools, public.departments, public.professors, public.courses, public.course_professors, public.syllabi, public.notices, public.faqs, public.posts, public.comments, public.course_reviews, public.professor_availability to anon, authenticated;
grant select, insert, update, delete on public.profiles, public.student_profiles, public.student_courses, public.roadmap_requests, public.roadmap_results, public.post_reactions, public.reports, public.chat_sessions, public.chat_messages, public.escalations, public.counseling_requests to authenticated;
grant insert on public.posts, public.comments, public.course_reviews to authenticated;
grant update on public.posts, public.comments, public.course_reviews to authenticated;

create policy "public read schools" on public.schools for select to anon, authenticated using (true);
create policy "public read departments" on public.departments for select to anon, authenticated using (true);
create policy "public read professors" on public.professors for select to anon, authenticated using (true);
create policy "public read courses" on public.courses for select to anon, authenticated using (true);
create policy "public read course professors" on public.course_professors for select to anon, authenticated using (true);
create policy "public read syllabi" on public.syllabi for select to anon, authenticated using (true);
create policy "public read notices" on public.notices for select to anon, authenticated using (true);
create policy "public read approved faqs" on public.faqs for select to anon, authenticated using (approved_at is not null);
create policy "public read active posts" on public.posts for select to anon, authenticated using (status = 'active');
create policy "public read active comments" on public.comments for select to anon, authenticated using (status = 'active');
create policy "public read reviews" on public.course_reviews for select to anon, authenticated using (true);
create policy "public read active availability" on public.professor_availability for select to anon, authenticated using (is_active);

create policy "users read own profile" on public.profiles for select to authenticated using ((select auth.uid()) = id);
create policy "users update own profile" on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
create policy "users read own student profile" on public.student_profiles for select to authenticated using ((select auth.uid()) = profile_id);
create policy "users write own student profile" on public.student_profiles for all to authenticated using ((select auth.uid()) = profile_id) with check ((select auth.uid()) = profile_id);
create policy "users manage own student courses" on public.student_courses for all to authenticated using ((select auth.uid()) = student_id) with check ((select auth.uid()) = student_id);
create policy "users manage own roadmap requests" on public.roadmap_requests for all to authenticated using ((select auth.uid()) = student_id) with check ((select auth.uid()) = student_id);
create policy "users read own roadmap results" on public.roadmap_results for select to authenticated using (exists (select 1 from public.roadmap_requests rr where rr.id = request_id and rr.student_id = (select auth.uid())));

create policy "users create posts" on public.posts for insert to authenticated with check ((select auth.uid()) = author_id);
create policy "authors update own posts" on public.posts for update to authenticated using ((select auth.uid()) = author_id) with check ((select auth.uid()) = author_id);
create policy "users create comments" on public.comments for insert to authenticated with check ((select auth.uid()) = author_id);
create policy "authors update own comments" on public.comments for update to authenticated using ((select auth.uid()) = author_id) with check ((select auth.uid()) = author_id);
create policy "users manage own reactions" on public.post_reactions for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "users create reports" on public.reports for insert to authenticated with check ((select auth.uid()) = reporter_id);
create policy "users read own reports" on public.reports for select to authenticated using ((select auth.uid()) = reporter_id);
create policy "users create reviews" on public.course_reviews for insert to authenticated with check ((select auth.uid()) = author_id);
create policy "authors update own reviews" on public.course_reviews for update to authenticated using ((select auth.uid()) = author_id) with check ((select auth.uid()) = author_id);

create policy "users manage own chat sessions" on public.chat_sessions for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "users read own chat messages" on public.chat_messages for select to authenticated using (exists (select 1 from public.chat_sessions cs where cs.id = session_id and cs.user_id = (select auth.uid())));
create policy "users create own chat messages" on public.chat_messages for insert to authenticated with check (exists (select 1 from public.chat_sessions cs where cs.id = session_id and cs.user_id = (select auth.uid())));
create policy "users create escalations" on public.escalations for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "users read own escalations" on public.escalations for select to authenticated using ((select auth.uid()) = user_id or (select auth.uid()) = assigned_to);
create policy "assigned staff update escalations" on public.escalations for update to authenticated using ((select auth.uid()) = assigned_to) with check ((select auth.uid()) = assigned_to);

create policy "users create counseling requests" on public.counseling_requests for insert to authenticated with check ((select auth.uid()) = student_id);
create policy "users read own counseling requests" on public.counseling_requests for select to authenticated using ((select auth.uid()) = student_id or exists (select 1 from public.professors p where p.id = professor_id and p.profile_id = (select auth.uid())));
create policy "professors update own counseling requests" on public.counseling_requests for update to authenticated using (exists (select 1 from public.professors p where p.id = professor_id and p.profile_id = (select auth.uid()))) with check (exists (select 1 from public.professors p where p.id = professor_id and p.profile_id = (select auth.uid())));

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
  returning id, department_id
),
seed_course as (
  insert into public.courses (
    school_id,
    department_id,
    code,
    name,
    credit,
    category,
    recommended_grade,
    description,
    prerequisite_text
  )
  select
    sd.school_id,
    sd.id,
    '21139-01',
    '민사소송법(2)',
    3,
    '전공선택',
    4,
    '민사절차법인 민사소송법 중에서도 관념적 형성절차인 판결절차에서 확정된 내용을 소위 사실적 형성 절차라고 하는 강제집행제도에 관한 여러 절차 및 제도, 즉 동산·부동산에 대한 집행, 가압류, 가처분 등에 관한 지식을 습득케 한다.',
    '민법에 대한 전반적인 이해가 필요함. 민사소송법 I 강의를 수강했거나 이해했을 것을 전제로 함.'
  from seed_department sd
  on conflict (school_id, code) do update set
    name = excluded.name,
    credit = excluded.credit,
    category = excluded.category,
    recommended_grade = excluded.recommended_grade,
    description = excluded.description,
    prerequisite_text = excluded.prerequisite_text
  returning id
),
seed_course_professor as (
  insert into public.course_professors (course_id, professor_id, semester_label)
  select sc.id, sp.id, '샘플 강의계획서'
  from seed_course sc cross join seed_professor sp
  on conflict (course_id, professor_id, semester_label) do nothing
  returning id
)
insert into public.syllabi (course_id, source_name, parsed_text)
select
  id,
  '강의계획서.hwp',
  '민사소송법(2) 강의계획서. 담당교수 박성은. 강의시간 화 09:00~10:15, 목 15:00~16:15. 평가: 출석 20%, 기말시험 40%, 중간고사 30%, 과제 10%. 주차별 내용: 1주차 강의소개 및 민사소송 절차 개관, 8주차 중간고사 및 문제풀이, 15주차 기말평가.'
from seed_course;;
