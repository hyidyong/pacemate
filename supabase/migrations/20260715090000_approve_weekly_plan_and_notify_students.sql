begin;

-- One transaction owns both the final plan state and the student-facing
-- notice.  A failed notification insert therefore cannot leave a plan marked
-- approved without telling the affected students how to opt in to the update.
create or replace function public.approve_course_weekly_plan(
  p_offering_id uuid,
  p_professor_id uuid,
  p_weeks jsonb
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_course_id uuid;
  v_course_name text;
begin
  if jsonb_typeof(p_weeks) <> 'array' or jsonb_array_length(p_weeks) <> 15 then
    raise exception 'exactly fifteen weekly plans are required';
  end if;

  select offering.course_id, course.name
    into v_course_id, v_course_name
    from public.course_offerings offering
    join public.courses course on course.id = offering.course_id
   where offering.id = p_offering_id
     and offering.professor_id = p_professor_id;

  if v_course_id is null then
    raise exception 'offering is not owned by professor';
  end if;

  if (select count(distinct item.week_number)
        from jsonb_to_recordset(p_weeks) as item(week_number integer)) <> 15
     or exists (
       select 1
         from jsonb_to_recordset(p_weeks) as item(week_number integer, title text, topic text)
        where item.week_number not between 1 and 15
           or nullif(btrim(item.title), '') is null
           or nullif(btrim(item.topic), '') is null
     ) then
    raise exception 'weekly plan payload is invalid';
  end if;

  insert into public.course_weekly_plans (
    offering_id, week_number, title, topic, content, learning_objectives,
    preview_guide, review_guide, assignment_json, source_syllabus_id,
    source_reference, extraction_confidence, review_required, professor_confirmed
  )
  select
    p_offering_id,
    item.week_number,
    item.title,
    item.topic,
    null,
    '[]'::jsonb,
    null,
    null,
    null,
    item.source_syllabus_id,
    item.source_reference,
    item.extraction_confidence,
    false,
    true
  from jsonb_to_recordset(p_weeks) as item(
    week_number integer,
    title text,
    topic text,
    source_syllabus_id uuid,
    source_reference text,
    extraction_confidence numeric
  )
  on conflict (offering_id, week_number) do update set
    title = excluded.title,
    topic = excluded.topic,
    content = excluded.content,
    learning_objectives = excluded.learning_objectives,
    preview_guide = excluded.preview_guide,
    review_guide = excluded.review_guide,
    assignment_json = excluded.assignment_json,
    source_syllabus_id = excluded.source_syllabus_id,
    source_reference = excluded.source_reference,
    extraction_confidence = excluded.extraction_confidence,
    review_required = false,
    professor_confirmed = true;

  insert into public.user_notifications (
    recipient_role, recipient_id, target_group, category, title, body, target_href
  )
  select
    'student',
    enrollment.student_id,
    'STUDENT',
    'revision',
    '주간 학습 계획 업데이트',
    format('담당 교수님의 검토로 %s의 주간 학습 계획이 업데이트되었습니다. 새로운 추천 로드맵을 확인해 보세요!', v_course_name),
    format('/roadmap?offering=%s&refresh=professor-plan', p_offering_id)
  from (
    select distinct student_id
      from public.student_courses
     where course_id = v_course_id
  ) as enrollment;
end;
$$;

revoke all on function public.approve_course_weekly_plan(uuid, uuid, jsonb) from public;

commit;
