create table if not exists public.roadmap_revision_requests (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('course', 'department')),
  status text not null default 'pending' check (status in ('pending', 'assistant_reviewed', 'approved', 'rejected')),
  course_code text,
  course_id text,
  department_name text,
  title text not null,
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

create table if not exists public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_role public.user_role,
  recipient_id uuid references public.profiles(id) on delete cascade,
  category text not null check (category in ('question', 'counseling', 'revision', 'system')),
  title text not null,
  body text not null,
  target_href text not null,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists roadmap_revision_requests_status_created_idx
  on public.roadmap_revision_requests(status, created_at desc);
create index if not exists roadmap_revision_requests_course_status_idx
  on public.roadmap_revision_requests(course_code, status, approved_at desc);
create index if not exists user_notifications_role_created_idx
  on public.user_notifications(recipient_role, created_at desc);
create index if not exists user_notifications_recipient_created_idx
  on public.user_notifications(recipient_id, created_at desc);

drop trigger if exists roadmap_revision_requests_set_updated_at on public.roadmap_revision_requests;
create trigger roadmap_revision_requests_set_updated_at before update on public.roadmap_revision_requests
for each row execute function public.set_updated_at();

alter table public.roadmap_revision_requests enable row level security;
alter table public.user_notifications enable row level security;

grant select, insert, update on public.roadmap_revision_requests to anon, authenticated;
grant select, insert, update on public.user_notifications to anon, authenticated;

create policy "demo read roadmap revision requests"
  on public.roadmap_revision_requests for select to anon, authenticated
  using (status in ('pending', 'assistant_reviewed', 'approved', 'rejected'));

create policy "demo create roadmap revision requests"
  on public.roadmap_revision_requests for insert to anon, authenticated
  with check (
    title <> ''
    and summary <> ''
    and status = 'pending'
    and jsonb_typeof(proposed_patch) = 'object'
  );

create policy "demo review roadmap revision requests"
  on public.roadmap_revision_requests for update to anon, authenticated
  using (status in ('pending', 'assistant_reviewed', 'approved', 'rejected'))
  with check (status in ('pending', 'assistant_reviewed', 'approved', 'rejected'));

create policy "demo read notifications"
  on public.user_notifications for select to anon, authenticated
  using (target_href <> '');

create policy "demo create notifications"
  on public.user_notifications for insert to anon, authenticated
  with check (title <> '' and body <> '' and target_href <> '');

create policy "demo update notifications"
  on public.user_notifications for update to anon, authenticated
  using (target_href <> '')
  with check (target_href <> '');

with professor_profile as (
  select id, name from public.profiles where role = 'professor' order by created_at limit 1
), seed_request as (
  insert into public.roadmap_revision_requests (
    scope,
    status,
    course_code,
    course_id,
    department_name,
    title,
    summary,
    proposed_by,
    proposed_by_name,
    source_title,
    source_url,
    proposed_patch
  )
  select
    'course',
    'pending',
    '21139-01',
    'civil-procedure-2',
    '법학과',
    '민사소송법(2) 기초지식 보강 요청',
    '블루북/강의계획서 기준으로 기판력과 증명책임을 먼저 보도록 조정합니다.',
    pp.id,
    coalesce(pp.name, '박성은 교수'),
    '강의계획서.hwp',
    '/courses',
    jsonb_build_object(
      'shortReason', '교수 검수 요청: 민사소송법 I, 기판력, 증명책임을 먼저 정리하면 후반 절차 이해가 안정적입니다.',
      'basics', jsonb_build_array('민사소송법 I', '기판력', '증명책임', '소송요건', '항변과 재항변'),
      'generalStudyMethod', jsonb_build_array('강의 전 블루북/강의계획서의 목차를 먼저 확인하고 핵심 조문을 표시합니다.', '수업 후 판례 키워드와 절차 흐름을 한 장 도식으로 정리합니다.'),
      'courseStudyMethod', jsonb_build_array('중간 전에는 변론과 증거 파트를 사례형 목차로 연습합니다.', '기말 전에는 판결 효력과 상소 구조를 비교표로 정리합니다.'),
      'weeklyFocus', jsonb_build_array('민사소송법 I 복습', '증명책임', '기판력', '상소', '사례 답안')
    )
  from professor_profile pp
  where not exists (
    select 1 from public.roadmap_revision_requests
    where course_code = '21139-01' and title = '민사소송법(2) 기초지식 보강 요청'
  )
  returning id
)
insert into public.user_notifications (recipient_role, category, title, body, target_href)
select 'admin', 'revision', '로드맵 수정 승인 요청', '교수 수정 요청이 검수 대기 중입니다.', '/admin'
where exists (select 1 from seed_request)
  and not exists (
    select 1 from public.user_notifications
    where recipient_role = 'admin' and title = '로드맵 수정 승인 요청' and target_href = '/admin'
  );;
