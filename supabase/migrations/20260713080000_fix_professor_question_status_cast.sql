begin;

do $$
declare
  function_source text;
begin
  select p.prosrc into function_source
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'create_professor_question'
    and pg_get_function_identity_arguments(p.oid) =
      'p_course_id uuid, p_category text, p_question text, p_submission_key uuid, p_source_message_id uuid, p_source_kind text';

  if function_source is null then
    raise exception 'public.create_professor_question is required';
  end if;

  if position('case when v_rule.id is null then ''pending'' else ''answered'' end' in function_source) = 0 then
    raise exception 'create_professor_question body is not the expected pre-fix version';
  end if;
end
$$;

create or replace function public.create_professor_question(
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

  select p.id into v_student_profile_id
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
    select m.content into v_question
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
  select rule.* into v_rule
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
    case
      when v_rule.id is null then 'pending'::public.escalation_status
      else 'answered'::public.escalation_status
    end,
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
    select e.* into v_row
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

revoke execute on function public.create_professor_question(uuid,text,text,uuid,uuid,text)
  from anon;
grant execute on function public.create_professor_question(uuid,text,text,uuid,uuid,text)
  to authenticated;

do $$
declare
  function_source text;
begin
  select p.prosrc into function_source
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'create_professor_question'
    and pg_get_function_identity_arguments(p.oid) =
      'p_course_id uuid, p_category text, p_question text, p_submission_key uuid, p_source_message_id uuid, p_source_kind text';

  if position('''pending''::public.escalation_status' in function_source) = 0
     or has_function_privilege(
       'anon',
       'public.create_professor_question(uuid,text,text,uuid,uuid,text)',
       'EXECUTE'
     ) then
    raise exception 'professor question status-cast postcondition failed';
  end if;
end
$$;

commit;
