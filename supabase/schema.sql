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
set search_path = ''
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
  is_favorite boolean not null default false,
  schedule_day text,
  start_time time,
  end_time time,
  classroom text,
  semester_label text not null default '2026-2',
  source_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
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
  day_of_week int check (day_of_week between 0 and 6),
  content text not null,
  category text,
  file_url text,
  course_id uuid references public.courses(id) on delete cascade,
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

create table public.roadmap_revision_requests (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('course', 'department')),
  status text not null default 'pending' check (status in ('pending', 'assistant_reviewed', 'approved', 'rejected')),
  course_code text,
  course_id text,
  department_name text,
  title text not null,
  day_of_week int check (day_of_week between 0 and 6),
  summary text not null,
  proposed_by uuid references public.profiles(id) on delete set null,
  proposed_by_name text not null default '교수',
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_by_name text,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_by_name text,
  source_title text,
  source_url text,
  proposed_patch jsonb not null default '{}'::jsonb,
  admin_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reviewed_at timestamptz,
  approved_at timestamptz,
  rejected_at timestamptz,
  constraint roadmap_revision_scope_target check (
    (scope = 'course' and coalesce(course_code, course_id) is not null)
    or (scope = 'department' and department_name is not null)
  )
);

create table public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_role public.user_role,
  recipient_id uuid references public.profiles(id) on delete cascade,
  category text not null check (category in ('question', 'counseling', 'revision', 'system')),
  title text not null,
  day_of_week int check (day_of_week between 0 and 6),
  body text not null,
  target_href text not null,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid references public.profiles(id) on delete set null,
  school_id uuid references public.schools(id) on delete set null,
  category text not null,
  board_key text not null default 'question',
  title text not null,
  day_of_week int check (day_of_week between 0 and 6),
  content text not null,
  course_id uuid references public.courses(id) on delete set null,
  display_mode text not null default 'anonymous',
  anonymous_alias text,
  view_count int not null default 0,
  is_resolved boolean not null default false,
  resolved_by_post_id uuid references public.posts(id) on delete set null,
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
  day_of_week int check (day_of_week between 0 and 6),
  specific_date date,
  start_time time not null,
  end_time time not null,
  slot_minutes int not null default 30 check (slot_minutes in (10, 15, 20, 30, 60)),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint professor_availability_time_order check (start_time < end_time),
  constraint professor_availability_date_or_day check ((day_of_week is not null) or (specific_date is not null))
);

create table public.professor_teaching_slots (
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

create table public.counseling_requests (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  professor_id uuid not null references public.professors(id) on delete cascade,
  requested_start timestamptz not null,
  requested_end timestamptz not null,
  topic text not null,
  status public.counseling_status not null default 'pending',
  professor_note text,
  location text,
  suggested_start timestamptz,
  suggested_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint counseling_requests_time_order check (requested_start < requested_end)
);

create unique index counseling_requests_confirmed_slot_idx
  on public.counseling_requests (professor_id, requested_start, requested_end)
  where status in ('pending', 'approved');

create index courses_department_id_idx on public.courses(department_id);
create index chat_sessions_user_id_idx on public.chat_sessions(user_id);
create index comments_author_id_idx on public.comments(author_id);
create index counseling_requests_student_id_idx on public.counseling_requests(student_id);
create index course_professors_professor_id_idx on public.course_professors(professor_id);
create index course_reviews_author_id_idx on public.course_reviews(author_id);
create index escalations_assigned_to_idx on public.escalations(assigned_to);
create index escalations_source_message_id_idx on public.escalations(source_message_id);
create index escalations_user_id_idx on public.escalations(user_id);
create index faqs_course_id_idx on public.faqs(course_id);
create index faqs_created_by_idx on public.faqs(created_by);
create index faqs_professor_id_idx on public.faqs(professor_id);
create index notices_created_by_idx on public.notices(created_by);
create index post_reactions_user_id_idx on public.post_reactions(user_id);
create index posts_author_id_idx on public.posts(author_id);
create index professor_availability_professor_id_idx on public.professor_availability(professor_id);
create index professor_teaching_slots_course_id_idx on public.professor_teaching_slots(course_id);
create index professor_teaching_slots_professor_day_idx on public.professor_teaching_slots(professor_id, day_of_week, start_time);
create index professors_department_id_idx on public.professors(department_id);
create index professors_profile_id_idx on public.professors(profile_id);
create index profiles_department_id_idx on public.profiles(department_id);
create index profiles_school_id_idx on public.profiles(school_id);
create index reports_reporter_id_idx on public.reports(reporter_id);
create index roadmap_requests_student_id_idx on public.roadmap_requests(student_id);
create index roadmap_results_request_id_idx on public.roadmap_results(request_id);
create index roadmap_revision_requests_status_created_idx on public.roadmap_revision_requests(status, created_at desc);
create index roadmap_revision_requests_course_status_idx on public.roadmap_revision_requests(course_code, status, approved_at desc);
create index student_courses_course_id_idx on public.student_courses(course_id);
create index student_courses_student_updated_idx on public.student_courses(student_id, updated_at desc);
create index student_courses_favorite_idx on public.student_courses(student_id, is_favorite) where is_favorite;
create index syllabi_course_id_idx on public.syllabi(course_id);
create index syllabi_uploaded_by_idx on public.syllabi(uploaded_by);
create index posts_course_id_idx on public.posts(course_id);
create index posts_category_created_at_idx on public.posts(category, created_at desc);
create index posts_school_board_created_idx on public.posts(school_id, board_key, created_at desc);
create index posts_school_course_created_idx on public.posts(school_id, course_id, created_at desc);
create index posts_resolved_by_post_id_idx on public.posts(resolved_by_post_id);
create index comments_post_id_created_at_idx on public.comments(post_id, created_at);
create index course_reviews_course_id_idx on public.course_reviews(course_id);
create index chat_messages_session_id_created_at_idx on public.chat_messages(session_id, created_at);
create index escalations_status_created_at_idx on public.escalations(status, created_at);
create index counseling_requests_professor_status_idx on public.counseling_requests(professor_id, status);
create index counseling_requests_suggested_start_idx on public.counseling_requests(professor_id, suggested_start) where suggested_start is not null;
create index user_notifications_role_created_idx on public.user_notifications(recipient_role, created_at desc);
create index user_notifications_recipient_created_idx on public.user_notifications(recipient_id, created_at desc);

create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();
create trigger student_profiles_set_updated_at before update on public.student_profiles
for each row execute function public.set_updated_at();
create trigger professors_set_updated_at before update on public.professors
for each row execute function public.set_updated_at();
create trigger courses_set_updated_at before update on public.courses
for each row execute function public.set_updated_at();
create trigger student_courses_set_updated_at before update on public.student_courses
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
create trigger roadmap_revision_requests_set_updated_at before update on public.roadmap_revision_requests
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
alter table public.roadmap_revision_requests enable row level security;
alter table public.posts enable row level security;
alter table public.comments enable row level security;
alter table public.post_reactions enable row level security;
alter table public.reports enable row level security;
alter table public.course_reviews enable row level security;
alter table public.chat_sessions enable row level security;
alter table public.chat_messages enable row level security;
alter table public.escalations enable row level security;
alter table public.professor_availability enable row level security;
alter table public.professor_teaching_slots enable row level security;
alter table public.counseling_requests enable row level security;
alter table public.user_notifications enable row level security;

grant usage on schema public to anon, authenticated;
grant select, insert, update on public.profiles to anon;
grant select on public.schools, public.departments, public.professors, public.courses, public.course_professors, public.syllabi, public.notices, public.faqs, public.posts, public.comments, public.course_reviews, public.professor_availability, public.professor_teaching_slots to anon, authenticated;
grant select, insert, update, delete on public.student_profiles, public.student_courses, public.post_reactions to anon;
grant insert, update on public.posts to anon;
grant select, insert, update, delete on public.professor_availability to anon;
grant select, insert, update, delete on public.professor_teaching_slots to anon;
grant select, insert, update on public.faqs to anon;
grant select, insert, update on public.counseling_requests to anon;
grant select, insert, update on public.roadmap_revision_requests, public.user_notifications to anon;
grant insert, update on public.course_reviews to anon;
grant select, insert, update, delete on public.profiles, public.student_profiles, public.student_courses, public.roadmap_requests, public.roadmap_results, public.post_reactions, public.reports, public.chat_sessions, public.chat_messages, public.escalations, public.counseling_requests to authenticated;
grant select, insert, update on public.roadmap_revision_requests, public.user_notifications to authenticated;
grant insert on public.posts, public.comments, public.course_reviews to authenticated;
grant update on public.posts, public.comments, public.course_reviews to authenticated;

create policy "public read schools" on public.schools for select to anon, authenticated using (true);
create policy "public read departments" on public.departments for select to anon, authenticated using (true);
create policy "public read professors" on public.professors for select to anon, authenticated using (true);
create policy "public read courses" on public.courses for select to anon, authenticated using (true);
create policy "public read course professors" on public.course_professors for select to anon, authenticated using (true);
create policy "public read syllabi" on public.syllabi for select to anon, authenticated using (true);
create policy "public read notices" on public.notices for select to anon, authenticated using (true);
create policy "authenticated insert notices" on public.notices for insert to authenticated with check (true);
create policy "public read approved faqs" on public.faqs for select to anon, authenticated using (approved_at is not null);
create policy "public read active posts" on public.posts for select to anon, authenticated using (status = 'active');
create policy "public read active comments" on public.comments for select to anon, authenticated using (status = 'active');
create policy "public read reviews" on public.course_reviews for select to anon, authenticated using (true);
create policy "public read active availability" on public.professor_availability for select to anon, authenticated using (is_active);
create policy "public read professor teaching slots" on public.professor_teaching_slots for select to anon, authenticated using (true);
create policy "demo anon read profiles by identifier" on public.profiles for select to anon using (true);
create policy "demo anon create profiles" on public.profiles for insert to anon with check (identifier <> '' and name <> '');
create policy "demo anon update profiles" on public.profiles for update to anon using (identifier <> '' and name <> '') with check (identifier <> '' and name <> '');
create policy "demo anon manage student profiles" on public.student_profiles for all to anon using (profile_id is not null) with check (profile_id is not null);
create policy "demo anon manage student courses" on public.student_courses for all to anon using (student_id is not null) with check (student_id is not null);
create policy "demo anon create posts" on public.posts for insert to anon with check (title <> '' and content <> '' and status = 'active');
create policy "demo anon update own-ish posts" on public.posts for update to anon using (status = 'active') with check (status = 'active');
create policy "demo anon manage reactions" on public.post_reactions for all to anon using (user_id is not null) with check (user_id is not null);
create policy "demo anon manage professor availability" on public.professor_availability for all to anon using (professor_id is not null) with check (professor_id is not null);
create policy "demo anon manage professor teaching slots" on public.professor_teaching_slots for all to anon using (professor_id is not null and course_id is not null) with check (professor_id is not null and course_id is not null);
create policy "demo anon manage professor faqs" on public.faqs for all to anon using (professor_id is not null) with check (professor_id is not null and question <> '' and answer <> '');
create policy "demo anon create counseling requests" on public.counseling_requests for insert to anon
with check (student_id is not null and professor_id is not null and topic <> '' and requested_start < requested_end);
create policy "demo anon read counseling requests" on public.counseling_requests for select to anon using (professor_id is not null);
create policy "demo anon update counseling requests" on public.counseling_requests for update to anon
using (
  exists (
    select 1
    from public.professors p
    where p.id = professor_id
      and p.email = 'zivilprozess_park@kmu.ac.kr'
  )
)
with check (
  exists (
    select 1
    from public.professors p
    where p.id = professor_id
      and p.email = 'zivilprozess_park@kmu.ac.kr'
  )
);

create policy "demo read roadmap revision requests" on public.roadmap_revision_requests for select to anon, authenticated
using (status in ('pending', 'assistant_reviewed', 'approved', 'rejected'));
create policy "demo create roadmap revision requests" on public.roadmap_revision_requests for insert to anon, authenticated
with check (
  title <> ''
  and summary <> ''
  and status in ('pending', 'approved')
  and jsonb_typeof(proposed_patch) = 'object'
  and (
    status = 'pending'
    or (status = 'approved' and scope = 'course' and course_code is not null and approved_at is not null)
  )
);
create policy "demo review roadmap revision requests" on public.roadmap_revision_requests for update to anon, authenticated
using (status in ('pending', 'assistant_reviewed', 'approved', 'rejected'))
with check (status in ('pending', 'assistant_reviewed', 'approved', 'rejected'));
create policy "demo read notifications" on public.user_notifications for select to anon, authenticated
using (target_href <> '');
create policy "demo create notifications" on public.user_notifications for insert to anon, authenticated
with check (title <> '' and body <> '' and target_href <> '');
create policy "demo update notifications" on public.user_notifications for update to anon, authenticated
using (target_href <> '')
with check (target_href <> '');

create policy "users read own profile" on public.profiles for select to authenticated using ((select auth.uid()) = id);
create policy "users update own profile" on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
create policy "users read own student profile" on public.student_profiles for select to authenticated using ((select auth.uid()) = profile_id);
create policy "users create own student profile" on public.student_profiles for insert to authenticated with check ((select auth.uid()) = profile_id);
create policy "users update own student profile" on public.student_profiles for update to authenticated using ((select auth.uid()) = profile_id) with check ((select auth.uid()) = profile_id);
create policy "users delete own student profile" on public.student_profiles for delete to authenticated using ((select auth.uid()) = profile_id);
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
create policy "demo anon create course reviews" on public.course_reviews for insert to anon with check (author_id is not null and content <> '');
create policy "demo anon update course reviews" on public.course_reviews for update to anon using (author_id is not null) with check (author_id is not null and content <> '');

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
from seed_course;

with seed_professor as (
  select id
  from public.professors
  where email = 'zivilprozess_park@kmu.ac.kr'
  order by created_at
  limit 1
),
seed_course as (
  select id
  from public.courses
  where code = '21139-01'
  order by created_at
  limit 1
),
seed_availability as (
  insert into public.professor_availability (
    professor_id,
    day_of_week,
    start_time,
    end_time,
    slot_minutes
  )
  select id, 2, '10:00'::time, '12:00'::time, 30
  from seed_professor
  where not exists (
    select 1
    from public.professor_availability pa
    where pa.professor_id = seed_professor.id
      and pa.day_of_week = 2
      and pa.start_time = '10:00'::time
      and pa.end_time = '12:00'::time
  )
  returning id
)
insert into public.faqs (professor_id, course_id, question, answer, category, approved_at)
select
  sp.id,
  sc.id,
  '중간고사 범위는 어디까지인가요?',
  '수업 진도에 맞춰 공지하며, 시험 전 주차에 문제 풀이와 범위 정리를 함께 진행합니다.',
  '교수 답변',
  now()
from seed_professor sp
cross join seed_course sc
where not exists (
  select 1
  from public.faqs f
  where f.professor_id = sp.id
    and f.question = '중간고사 범위는 어디까지인가요?'
);

with seed_school as (
  select id from public.schools where name = '계명대학교' limit 1
),
seed_department as (
  select d.id, d.school_id
  from public.departments d
  join seed_school s on s.id = d.school_id
  where d.name = '법학과'
  limit 1
),
seed_professor as (
  select id
  from public.professors
  where email = 'zivilprozess_park@kmu.ac.kr'
  order by created_at
  limit 1
),
seed_courses as (
  insert into public.courses (
    school_id,
    department_id,
    code,
    name,
    credit,
    category,
    recommended_grade,
    description
  )
  select
    sd.school_id,
    sd.id,
    v.code,
    v.name,
    3,
    v.category,
    v.grade,
    v.description
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
seed_course_professors as (
  insert into public.course_professors (course_id, professor_id, semester_label)
  select sc.id, sp.id, '2026학년도'
  from seed_courses sc cross join seed_professor sp
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
  professor_id,
  course_id,
  day_of_week,
  period_label,
  start_time,
  end_time,
  classroom,
  course_type,
  target_label,
  semester_label
)
select
  sp.id,
  c.id,
  ss.day_of_week,
  ss.period_label,
  ss.start_time,
  ss.end_time,
  ss.classroom,
  ss.course_type,
  ss.target_label,
  '2026학년도'
from slot_source ss
join public.courses c on c.code = ss.code
cross join seed_professor sp
on conflict (professor_id, course_id, day_of_week, start_time, classroom, semester_label) do update set
  period_label = excluded.period_label,
  end_time = excluded.end_time,
  course_type = excluded.course_type,
  target_label = excluded.target_label;

with seed_school as (
  select id from public.schools where name = '계명대학교' limit 1
),
seed_department as (
  select d.id, d.school_id
  from public.departments d
  join seed_school s on s.id = d.school_id
  where d.name = '법학과'
  limit 1
),
course_source as (
  select * from (values
    ('19374-01', '회사법', 3, '전공선택', 3, '상법 중 회사법 편으로 회사제도의 기본 법리와 주식회사, 합명회사, 합자회사, 유한회사에 관한 법적 제도와 법률관계의 합리적 해석방법을 습득한다.', '추천 선수과목: 상법총론. 법전 지참을 권장함.', '김재두', '053-580-5467', 'kimjd@kmu.ac.kr', '쉐턱관 222-2', '회사법 강의계획서. 강의시간 월 16:30~17:45, 목 10:30~11:45. 강의실 쉐106. 평가: 출석 20%, 기말시험 30%, 중간고사 30%, 과제 20%.'),
    ('44359-01', '행정절차와행정구제', 3, '전공선택', 3, '행정절차와 행정의 실효성 확보수단 및 행정구제에 대한 학습을 통해 행정작용의 프로세스와 시민들의 권리구제 방법을 이해한다.', '행정법기초에 대한 이해가 있으면 도움이 됨. 공무원시험 대비자는 행정법 교과서 1권을 정독하며 병행 학습하기를 권장함.', '김영수', '053-580-5244', 'yskim0709@kmu.ac.kr', '쉐턱관 207-2', '행정절차와행정구제 강의계획서. 강의시간 월 15:00~16:15, 목 09:00~10:15. 강의실 쉐106. 평가: 출석 10%, 기말시험 50%, 중간고사 40%.')
  ) as v(code, name, credit, category, grade, description, prerequisite_text, professor_name, phone, email, office, syllabus_text)
),
seed_courses as (
  insert into public.courses (school_id, department_id, code, name, credit, category, recommended_grade, description, prerequisite_text)
  select sd.school_id, sd.id, cs.code, cs.name, cs.credit, cs.category, cs.grade, cs.description, cs.prerequisite_text
  from seed_department sd cross join course_source cs
  on conflict (school_id, code) do update set
    name = excluded.name,
    credit = excluded.credit,
    category = excluded.category,
    recommended_grade = excluded.recommended_grade,
    description = excluded.description,
    prerequisite_text = excluded.prerequisite_text,
    updated_at = now()
  returning id, code
),
seed_professors as (
  insert into public.professors (department_id, name, office, phone, email, bio)
  select sd.id, cs.professor_name, cs.office, cs.phone, cs.email, cs.name || ' 담당교수'
  from seed_department sd cross join course_source cs
  where not exists (select 1 from public.professors p where p.email = cs.email)
  returning id, email
),
professor_rows as (
  select p.id, p.email
  from public.professors p
  join course_source cs on cs.email = p.email
),
course_rows as (
  select c.id, c.code
  from public.courses c
  join seed_school s on c.school_id = s.id
  join course_source cs on cs.code = c.code
),
seed_course_professors as (
  insert into public.course_professors (course_id, professor_id, semester_label)
  select c.id, p.id, '2026-2'
  from course_rows c
  join course_source cs on cs.code = c.code
  join professor_rows p on p.email = cs.email
  on conflict (course_id, professor_id, semester_label) do nothing
),
seed_syllabi as (
  insert into public.syllabi (course_id, source_name, parsed_text)
  select c.id, cs.name || ' 강의계획서.pdf', cs.syllabus_text
  from course_rows c
  join course_source cs on cs.code = c.code
  where not exists (
    select 1 from public.syllabi s
    where s.course_id = c.id and s.source_name = cs.name || ' 강의계획서.pdf'
  )
),
slot_source as (
  select * from (values
    ('19374-01', 'kimjd@kmu.ac.kr', 1, '10A', '16:30'::time, '17:45'::time, '쉐106', '강의', '법학과 3년'),
    ('19374-01', 'kimjd@kmu.ac.kr', 4, '3B', '10:30'::time, '11:45'::time, '쉐106', '강의', '법학과 3년'),
    ('44359-01', 'yskim0709@kmu.ac.kr', 1, '8A', '15:00'::time, '16:15'::time, '쉐106', '강의', '법학과 3년'),
    ('44359-01', 'yskim0709@kmu.ac.kr', 4, '2A', '09:00'::time, '10:15'::time, '쉐106', '강의', '법학과 3년')
  ) as s(code, email, day_of_week, period_label, start_time, end_time, classroom, course_type, target_label)
)
insert into public.professor_teaching_slots (
  professor_id,
  course_id,
  day_of_week,
  period_label,
  start_time,
  end_time,
  classroom,
  course_type,
  target_label,
  semester_label
)
select p.id, c.id, ss.day_of_week, ss.period_label, ss.start_time, ss.end_time, ss.classroom, ss.course_type, ss.target_label, '2026-2'
from slot_source ss
join course_rows c on c.code = ss.code
join professor_rows p on p.email = ss.email
on conflict (professor_id, course_id, day_of_week, start_time, classroom, semester_label) do update set
  period_label = excluded.period_label,
  end_time = excluded.end_time,
  course_type = excluded.course_type,
  target_label = excluded.target_label;


create table public.professor_admin_tasks (
  id uuid primary key default gen_random_uuid(),
  professor_id uuid not null references public.professors(id) on delete cascade,
  title text not null,
  day_of_week int check (day_of_week between 0 and 6),
  day_of_week int not null check (day_of_week between 0 and 6),
  start_time time not null,
  end_time time not null,
  created_at timestamptz not null default now(),
  constraint professor_admin_tasks_time_order check (start_time < end_time)
);

alter table public.professor_admin_tasks enable row level security;
grant select, insert, delete on public.professor_admin_tasks to authenticated;

create policy "authenticated read professor admin tasks" on public.professor_admin_tasks for select to authenticated using (true);
create policy "professors insert own admin tasks" on public.professor_admin_tasks for insert to authenticated with check (
  exists (
    select 1 from public.professors pr
    join public.profiles p on p.id = pr.profile_id
    where pr.id = professor_admin_tasks.professor_id
      and p.auth_user_id = (select auth.uid())
      and p.role = 'professor'
  )
);
create policy "professors delete own admin tasks" on public.professor_admin_tasks for delete to authenticated using (
  exists (
    select 1 from public.professors pr
    join public.profiles p on p.id = pr.profile_id
    where pr.id = professor_admin_tasks.professor_id
      and p.auth_user_id = (select auth.uid())
      and p.role = 'professor'
  )
);

create index professor_admin_tasks_professor_id_idx on public.professor_admin_tasks(professor_id);



-- ==============================================
-- PaceMate Smart Roadmap & Login System
-- ==============================================

alter table public.profiles 
add column if not exists password_hash text;

alter table public.student_profiles 
add column if not exists is_onboarded boolean not null default false;

alter table public.student_courses 
add column if not exists understanding_status text check (understanding_status in ('mastered', 'learning', 'difficult', 'unknown')),
add column if not exists current_week int not null default 1;

create table public.course_weekly_missions (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  week_number int not null,
  predicted_progress_text text not null,
  prep_guide text,
  review_quiz jsonb,
  created_at timestamptz not null default now(),
  unique (course_id, week_number)
);

create table public.student_mission_progress (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  week_number int not null,
  is_completed boolean not null default false,
  actual_progress_feedback text,
  calibrated_by_ai boolean not null default false,
  calibrated_mission_json jsonb,
  updated_at timestamptz not null default now(),
  unique(student_id, course_id, week_number)
);

alter table public.course_weekly_missions enable row level security;
alter table public.student_mission_progress enable row level security;

grant select, insert, update, delete on public.course_weekly_missions to anon, authenticated;
grant select, insert, update, delete on public.student_mission_progress to anon, authenticated;

create policy "demo manage course_weekly_missions" on public.course_weekly_missions for all to anon, authenticated using (true) with check (true);
create policy "demo manage student_mission_progress" on public.student_mission_progress for all to anon, authenticated using (true) with check (true);



-- �ð�ǥ ���̺�
create table public.timetables (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  course_name text not null,
  day_of_week text not null, -- 'mon','tue','wed','thu','fri'
  start_time time not null,
  end_time time not null,
  room text,
  color text default '#22c55e',
  created_at timestamptz not null default now()
);

-- chat_sessions�� title �÷� �߰� (�������� ������ �߰�)
do $$$
begin
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='chat_sessions' and column_name='title') then
    alter table public.chat_sessions add column title text default '�� ��ȭ';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='chat_sessions' and column_name='profile_id') then
    alter table public.chat_sessions add column profile_id uuid references public.profiles(id) on delete cascade;
  end if;
end
$$$;

-- RLS
alter table public.timetables enable row level security;
create policy "own timetables" on public.timetables
  for all using (profile_id = current_setting('app.profile_id', true)::uuid);
