-- Stage 9 — RPC authorization: a bypass must re-establish what it bypassed.
--
-- The SECURITY DEFINER / RPC audit checked all nine app functions. Eight need no
-- change; the reasoning for each is in AUTHORIZATION_RLS_AUDIT.md §5. One does.
--
-- CORRECTION TO A DISCOVERY FINDING. The discovery pass reported that
-- `answer_professor_questions` lets any assistant answer any tenant's questions,
-- citing 20260714134426. That was verified against the LIVE function definition
-- and is FALSE: 20260812050000 (Stage 6) already rewrote the assistant branch to
-- require `courses.school_id = <staff school>`, and an assistant has no
-- `professors` row so the professor branch evaluates to NULL for them. No change
-- is made to that function; changing it would have been churn on a correct
-- policy, and its return type differs from what the report assumed.
--
-- THE REAL FINDING — `approve_course_weekly_plan` (20260715090000).
-- It is SECURITY INVOKER and takes `p_professor_id` from the caller. It checks
-- that the offering belongs to that professor, but never that the CALLER is
-- that professor. There is no live exploit: EXECUTE was revoked from `public`
-- and never granted to `anon`/`authenticated`, and the sole caller
-- (weekly-plan-approval.actions.ts) re-derives the professor from the session
-- and invokes through the service role. But the function's contract is
-- "whoever calls me names the professor", and the function upserts fifteen
-- weekly plans AND notifies every enrolled student — so a second caller, or one
-- future EXECUTE grant, turns it into a cross-professor content rewrite with a
-- mass notification attached.
--
-- The body below is the 20260715090000 body UNCHANGED. The only addition is the
-- caller-binding block marked "Stage 9". The service-role path (no auth.uid())
-- is deliberately preserved so the existing, correctly-authorized caller keeps
-- working; what is now impossible is a session-role caller naming somebody
-- else's professor id.
--
-- Preconditions asserted: the function exists.
-- Postconditions asserted: it still exists, and no client role holds EXECUTE.
-- Rollback: re-run 20260715090000.

begin;

do $$
begin
  if to_regprocedure('public.approve_course_weekly_plan(uuid, uuid, jsonb)') is null then
    raise exception 'precondition failed: approve_course_weekly_plan is missing';
  end if;
end
$$;

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
  v_caller uuid := (select auth.uid());
  v_caller_professor_id uuid;
begin
  -- Stage 9: when the call carries a user identity, the professor named in the
  -- arguments must BE that user. A caller-supplied identifier is a request, not
  -- proof. Service-role calls (auth.uid() is null) are unaffected — their
  -- authorization is established before the call, in the server action.
  if v_caller is not null then
    select professor.id
      into v_caller_professor_id
      from public.professors professor
      join public.profiles profile on profile.id = professor.profile_id
     where profile.auth_user_id = v_caller
       and profile.role = 'professor'
     limit 1;

    if v_caller_professor_id is null or v_caller_professor_id <> p_professor_id then
      raise exception 'caller is not the named professor';
    end if;
  end if;

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

revoke all on function public.approve_course_weekly_plan(uuid, uuid, jsonb) from public, anon, authenticated;

do $$
begin
  if to_regprocedure('public.approve_course_weekly_plan(uuid, uuid, jsonb)') is null then
    raise exception 'postcondition failed: approve_course_weekly_plan disappeared';
  end if;

  if has_function_privilege('anon', 'public.approve_course_weekly_plan(uuid, uuid, jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.approve_course_weekly_plan(uuid, uuid, jsonb)', 'execute') then
    raise exception 'postcondition failed: a client role can execute approve_course_weekly_plan';
  end if;
end
$$;

commit;
