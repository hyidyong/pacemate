begin;

do $$
declare
  required_table text;
begin
  foreach required_table in array array[
    'profiles', 'professors', 'courses', 'course_professors',
    'course_offerings', 'student_courses', 'chat_sessions',
    'chat_messages', 'escalations', 'user_notifications'
  ] loop
    if to_regclass('public.' || required_table) is null then
      raise exception 'required table public.% is missing', required_table;
    end if;
  end loop;

  if to_regprocedure('extensions.digest(text,text)') is null then
    raise exception 'extensions.digest(text,text) from pgcrypto is required';
  end if;

  if exists (select 1 from public.escalations) then
    raise exception 'existing escalations require an explicit data migration before this schema change';
  end if;

  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('profiles', 'professors', 'course_offerings', 'student_courses',
                        'chat_sessions', 'chat_messages', 'escalations')
      and not c.relrowsecurity
  ) then
    raise exception 'all ownership-chain tables must have RLS enabled';
  end if;

  if to_regclass('public.professor_question_auto_reply_rules') is not null then
    raise exception 'public.professor_question_auto_reply_rules already exists';
  end if;

  if to_regprocedure('public.create_professor_question(uuid,text,text,uuid,uuid,text)') is not null
     or to_regprocedure('public.answer_professor_questions(uuid[],text)') is not null then
    raise exception 'professor question RPC name collision';
  end if;
end
$$;

create function public.normalize_professor_question(p_value text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select trim(
    regexp_replace(
      regexp_replace(lower(p_value), '[[:punct:]]+', ' ', 'g'),
      '[[:space:]]+',
      ' ',
      'g'
    )
  )
$$;

create function public.professor_question_fingerprint(p_value text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select encode(
    extensions.digest(public.normalize_professor_question(p_value), 'sha256'),
    'hex'
  )
$$;

alter table public.escalations
  add column course_id uuid not null references public.courses(id) on delete restrict,
  add column professor_id uuid not null references public.professors(id) on delete restrict,
  add column source_kind text not null,
  add column normalized_question text generated always as (
    public.normalize_professor_question(question)
  ) stored,
  add column question_fingerprint text generated always as (
    public.professor_question_fingerprint(question)
  ) stored,
  add column submission_key uuid not null,
  add column answered_by uuid references public.profiles(id) on delete set null,
  add column answered_at timestamptz,
  add column answer_mode text,
  add constraint escalations_category_check check (
    category in ('과목 정보', '학사 행정', '수업 운영', '로드맵', '상담 필요')
  ),
  add constraint escalations_source_kind_check check (source_kind in ('direct', 'tutor')),
  add constraint escalations_source_message_check check (
    (source_kind = 'direct' and source_message_id is null)
    or (source_kind = 'tutor' and source_message_id is not null)
  ),
  add constraint escalations_answer_mode_check check (
    answer_mode is null or answer_mode in ('manual', 'automatic')
  ),
  add constraint escalations_answer_state_check check (
    (status = 'answered' and answer is not null and answered_at is not null and answer_mode is not null)
    or (status <> 'answered' and answer_mode is null)
  );

create unique index escalations_user_submission_key_idx
  on public.escalations(user_id, submission_key);

create unique index escalations_source_message_unique_idx
  on public.escalations(source_message_id)
  where source_message_id is not null;

create index escalations_professor_category_status_idx
  on public.escalations(professor_id, category, status, created_at desc);

create index escalations_professor_fingerprint_idx
  on public.escalations(professor_id, question_fingerprint, created_at desc);

create table public.professor_question_auto_reply_rules (
  id uuid primary key default gen_random_uuid(),
  professor_id uuid not null references public.professors(id) on delete cascade,
  course_id uuid references public.courses(id) on delete cascade,
  category text not null check (
    category in ('과목 정보', '학사 행정', '수업 운영', '로드맵', '상담 필요')
  ),
  pattern text not null check (length(trim(pattern)) between 2 and 200),
  normalized_pattern text generated always as (
    public.normalize_professor_question(pattern)
  ) stored,
  answer text not null check (length(trim(answer)) between 1 and 4000),
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (professor_id, course_id, category, normalized_pattern)
);

alter table public.professor_question_auto_reply_rules enable row level security;

alter table public.escalations
  add column auto_reply_rule_id uuid
  references public.professor_question_auto_reply_rules(id) on delete set null;

create index professor_question_auto_reply_rules_match_idx
  on public.professor_question_auto_reply_rules(
    professor_id, category, is_enabled, course_id
  );

-- Correct the legacy Auth/profile comparisons. Auth UUIDs are never profile UUIDs.
drop policy if exists "users manage own chat sessions" on public.chat_sessions;
create policy "users manage own chat sessions"
  on public.chat_sessions
  for all
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = chat_sessions.user_id
        and p.auth_user_id = (select auth.uid())
        and p.role = 'student'
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = chat_sessions.user_id
        and p.auth_user_id = (select auth.uid())
        and p.role = 'student'
    )
  );

drop policy if exists "users read own chat messages" on public.chat_messages;
create policy "users read own chat messages"
  on public.chat_messages
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.chat_sessions cs
      join public.profiles p on p.id = cs.user_id
      where cs.id = chat_messages.session_id
        and p.auth_user_id = (select auth.uid())
        and p.role = 'student'
    )
  );

drop policy if exists "users create own chat messages" on public.chat_messages;
create policy "users create own chat messages"
  on public.chat_messages
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.chat_sessions cs
      join public.profiles p on p.id = cs.user_id
      where cs.id = chat_messages.session_id
        and p.auth_user_id = (select auth.uid())
        and p.role = 'student'
    )
  );

create policy "students read own student courses for questions"
  on public.student_courses
  for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = student_courses.student_id
        and p.auth_user_id = (select auth.uid())
        and p.role = 'student'
    )
  );

create policy "students read assigned course offerings for questions"
  on public.course_offerings
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.student_courses sc
      join public.profiles p on p.id = sc.student_id
      where sc.offering_id = course_offerings.id
        and p.auth_user_id = (select auth.uid())
        and p.role = 'student'
    )
  );

drop policy if exists "users create escalations" on public.escalations;
drop policy if exists "users read own escalations" on public.escalations;
drop policy if exists "assigned staff update escalations" on public.escalations;

create policy "students read own professor questions"
  on public.escalations
  for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = escalations.user_id
        and p.auth_user_id = (select auth.uid())
        and p.role = 'student'
    )
  );

create policy "professors read own professor questions"
  on public.escalations
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.professors pr
      join public.profiles p on p.id = pr.profile_id
      where pr.id = escalations.professor_id
        and p.auth_user_id = (select auth.uid())
        and p.role = 'professor'
    )
  );

create policy "professors manage own auto reply rules"
  on public.professor_question_auto_reply_rules
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.professors pr
      join public.profiles p on p.id = pr.profile_id
      where pr.id = professor_question_auto_reply_rules.professor_id
        and p.auth_user_id = (select auth.uid())
        and p.role = 'professor'
    )
  )
  with check (
    exists (
      select 1
      from public.professors pr
      join public.profiles p on p.id = pr.profile_id
      where pr.id = professor_question_auto_reply_rules.professor_id
        and p.auth_user_id = (select auth.uid())
        and p.role = 'professor'
    )
    and (
      professor_question_auto_reply_rules.course_id is null
      or exists (
        select 1 from public.course_professors cp
        where cp.professor_id = professor_question_auto_reply_rules.professor_id
          and cp.course_id = professor_question_auto_reply_rules.course_id
      )
      or exists (
        select 1 from public.course_offerings co
        where co.professor_id = professor_question_auto_reply_rules.professor_id
          and co.course_id = professor_question_auto_reply_rules.course_id
      )
    )
  );

create function public.create_professor_question(
  p_course_id uuid,
  p_category text,
  p_question text,
  p_submission_key uuid,
  p_source_message_id uuid default null,
  p_source_kind text default 'direct'
)
returns table (
  question_id uuid,
  question_status text,
  question_answer text,
  was_created boolean,
  recipient_profile_id uuid,
  resolved_source_kind text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_auth_user_id uuid := auth.uid();
  v_student_profile_id uuid;
  v_offering_id uuid;
  v_student_course_count integer;
  v_professor_id uuid;
  v_professor_profile_id uuid;
  v_professor_count integer;
  v_question text;
  v_normalized_question text;
  v_rule public.professor_question_auto_reply_rules%rowtype;
  v_row public.escalations%rowtype;
  v_created boolean := false;
begin
  if v_auth_user_id is null then
    raise exception 'authentication required';
  end if;

  if p_course_id is null or p_submission_key is null then
    raise exception 'invalid question request';
  end if;

  if p_category is null or p_category not in (
    '과목 정보', '학사 행정', '수업 운영', '로드맵', '상담 필요'
  ) then
    raise exception 'invalid question category';
  end if;

  if p_source_kind not in ('direct', 'tutor') then
    raise exception 'invalid question source';
  end if;

  select p.id
    into v_student_profile_id
  from public.profiles p
  where p.auth_user_id = v_auth_user_id
    and p.role = 'student';

  if v_student_profile_id is null then
    raise exception 'student profile not found';
  end if;

  select count(*), (array_agg(sc.offering_id))[1]
    into v_student_course_count, v_offering_id
  from public.student_courses sc
  where sc.student_id = v_student_profile_id
    and sc.course_id = p_course_id;

  if v_student_course_count <> 1 then
    raise exception 'student course route is ambiguous or unavailable';
  end if;

  if p_source_kind = 'tutor' then
    if p_source_message_id is null then
      raise exception 'tutor source message is required';
    end if;

    select m.content
      into v_question
    from public.chat_messages m
    join public.chat_sessions s on s.id = m.session_id
    where m.id = p_source_message_id
      and m.role = 'user'
      and s.user_id = v_student_profile_id;
  else
    if p_source_message_id is not null then
      raise exception 'direct questions cannot reference a chat message';
    end if;
    v_question := trim(p_question);
  end if;

  if v_question is null or length(v_question) < 1 or length(v_question) > 2000 then
    raise exception 'invalid question body';
  end if;

  if v_offering_id is not null then
    select co.professor_id, pr.profile_id
      into v_professor_id, v_professor_profile_id
    from public.course_offerings co
    join public.professors pr on pr.id = co.professor_id
    where co.id = v_offering_id
      and co.course_id = p_course_id
      and pr.profile_id is not null;

    if v_professor_id is null then
      raise exception 'assigned offering professor route not found';
    end if;
  else
    select count(*), (array_agg(route.professor_id))[1], (array_agg(route.profile_id))[1]
      into v_professor_count, v_professor_id, v_professor_profile_id
    from (
      select distinct cp.professor_id, pr.profile_id
      from public.course_professors cp
      join public.professors pr on pr.id = cp.professor_id
      where cp.course_id = p_course_id
        and pr.profile_id is not null
    ) route;

    if v_professor_count <> 1 then
      raise exception 'course professor route is ambiguous or unavailable';
    end if;
  end if;

  v_normalized_question := public.normalize_professor_question(v_question);

  select rule.*
    into v_rule
  from public.professor_question_auto_reply_rules rule
  where rule.professor_id = v_professor_id
    and rule.category = p_category
    and rule.is_enabled
    and (rule.course_id is null or rule.course_id = p_course_id)
    and position(rule.normalized_pattern in v_normalized_question) > 0
  order by (rule.course_id is not null) desc,
           length(rule.normalized_pattern) desc,
           rule.id
  limit 1;

  insert into public.escalations (
    user_id, assigned_to, source_message_id, category, question, status,
    answer, resolved_at, offering_id, course_id, professor_id, source_kind,
    submission_key, answered_by, answered_at, answer_mode, auto_reply_rule_id
  ) values (
    v_student_profile_id,
    v_professor_profile_id,
    p_source_message_id,
    p_category,
    v_question,
    case when v_rule.id is null then 'pending' else 'answered' end,
    v_rule.answer,
    case when v_rule.id is null then null else now() end,
    v_offering_id,
    p_course_id,
    v_professor_id,
    p_source_kind,
    p_submission_key,
    case when v_rule.id is null then null else v_professor_profile_id end,
    case when v_rule.id is null then null else now() end,
    case when v_rule.id is null then null else 'automatic' end,
    v_rule.id
  )
  on conflict do nothing
  returning * into v_row;

  if v_row.id is not null then
    v_created := true;
  else
    select e.*
      into v_row
    from public.escalations e
    where e.user_id = v_student_profile_id
      and (
        e.submission_key = p_submission_key
        or (p_source_message_id is not null and e.source_message_id = p_source_message_id)
      )
    order by e.created_at
    limit 1;

    if v_row.id is null
       or v_row.course_id <> p_course_id
       or v_row.source_kind <> p_source_kind then
      raise exception 'question idempotency conflict';
    end if;
  end if;

  return query select
    v_row.id,
    v_row.status::text,
    v_row.answer,
    v_created,
    case when v_row.status = 'answered' then v_student_profile_id else v_professor_profile_id end,
    v_row.source_kind;
end
$$;

create function public.answer_professor_questions(
  p_question_ids uuid[],
  p_answer text
)
returns table (question_id uuid, student_profile_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_auth_user_id uuid := auth.uid();
  v_professor_profile_id uuid;
  v_professor_id uuid;
  v_requested_count integer;
  v_authorized_count integer;
  v_answer text := trim(p_answer);
begin
  if v_auth_user_id is null then
    raise exception 'authentication required';
  end if;

  select p.id, pr.id
    into v_professor_profile_id, v_professor_id
  from public.profiles p
  join public.professors pr on pr.profile_id = p.id
  where p.auth_user_id = v_auth_user_id
    and p.role = 'professor';

  if v_professor_id is null then
    raise exception 'professor profile not found';
  end if;

  if p_question_ids is null or cardinality(p_question_ids) < 1
     or cardinality(p_question_ids) > 50
     or v_answer is null or length(v_answer) < 1 or length(v_answer) > 4000 then
    raise exception 'invalid bulk answer request';
  end if;

  select count(distinct id)
    into v_requested_count
  from unnest(p_question_ids) id
  where id is not null;

  if v_requested_count <> cardinality(p_question_ids) then
    raise exception 'question IDs must be unique and non-null';
  end if;

  select count(*)
    into v_authorized_count
  from public.escalations e
  where e.id = any(p_question_ids)
    and e.professor_id = v_professor_id
    and e.status in ('pending', 'assigned');

  if v_authorized_count <> v_requested_count then
    raise exception 'one or more questions are unavailable or unauthorized';
  end if;

  return query
  update public.escalations e
     set status = 'answered',
         answer = v_answer,
         resolved_at = now(),
         answered_by = v_professor_profile_id,
         answered_at = now(),
         answer_mode = 'manual',
         auto_reply_rule_id = null
   where e.id = any(p_question_ids)
     and e.professor_id = v_professor_id
     and e.status in ('pending', 'assigned')
  returning e.id, e.user_id;
end
$$;

revoke all on public.escalations from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.escalations from authenticated;
grant select on public.escalations to authenticated;

revoke all on public.professor_question_auto_reply_rules from anon;
grant select, insert, update, delete
  on public.professor_question_auto_reply_rules to authenticated;

revoke all on function public.normalize_professor_question(text) from public;
revoke all on function public.professor_question_fingerprint(text) from public;
revoke all on function public.create_professor_question(uuid,text,text,uuid,uuid,text) from public;
revoke all on function public.answer_professor_questions(uuid[],text) from public;
grant execute on function public.normalize_professor_question(text) to authenticated;
grant execute on function public.create_professor_question(uuid,text,text,uuid,uuid,text)
  to authenticated;
grant execute on function public.answer_professor_questions(uuid[],text)
  to authenticated;

do $$
declare
  policy_count integer;
begin
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('escalations', 'professor_question_auto_reply_rules')
      and c.relrowsecurity
    group by n.nspname
    having count(*) = 2
  ) then
    raise exception 'question workflow RLS postcondition failed';
  end if;

  select count(*) into policy_count
  from pg_policies
  where schemaname = 'public'
    and policyname in (
      'students read own professor questions',
      'professors read own professor questions',
      'professors manage own auto reply rules',
      'students read own student courses for questions',
      'students read assigned course offerings for questions'
    );

  if policy_count <> 5 then
    raise exception 'question workflow policy postcondition failed';
  end if;

  if has_table_privilege('anon', 'public.escalations', 'SELECT')
     or has_table_privilege('anon', 'public.escalations', 'INSERT')
     or has_table_privilege('anon', 'public.escalations', 'UPDATE')
     or has_table_privilege('anon', 'public.escalations', 'DELETE') then
    raise exception 'anon unexpectedly retains escalation privileges';
  end if;

  if not has_table_privilege('authenticated', 'public.escalations', 'SELECT')
     or has_table_privilege('authenticated', 'public.escalations', 'INSERT')
     or has_table_privilege('authenticated', 'public.escalations', 'UPDATE')
     or has_table_privilege('authenticated', 'public.escalations', 'DELETE') then
    raise exception 'authenticated escalation privileges are not minimal';
  end if;

  if to_regprocedure('public.create_professor_question(uuid,text,text,uuid,uuid,text)') is null
     or to_regprocedure('public.answer_professor_questions(uuid[],text)') is null then
    raise exception 'question workflow RPC postcondition failed';
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'escalations'
      and indexname = 'escalations_user_submission_key_idx'
  ) or not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'escalations'
      and indexname = 'escalations_source_message_unique_idx'
  ) then
    raise exception 'question idempotency indexes were not created';
  end if;
end
$$;

commit;
