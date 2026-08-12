-- Stage 6 (multi-tenancy) M6: DB-layer tenant backstops.
--   1. counseling INSERT policy gains a tenant clause so a crafted
--      authenticated PostgREST insert cannot book a professor outside the
--      student's tenant (defence-in-depth behind the server boundary).
--   2. Drop the dead demo-anon UPDATE policy on counseling_requests (gated on
--      a hardcoded professor email; no app path uses it) and revoke the
--      residual anon UPDATE grant.
--   3. answer_professor_questions: the assistant branch is tenant-scoped so an
--      assistant can only answer questions within their own school (the
--      professor branch is already tenant-safe — a professor only matches
--      their own professor_id).
-- Runs AFTER professors.school_id (M2) and profiles NOT NULL (M5) exist.
begin;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'professors'
      and column_name = 'school_id'
  ) then
    raise exception 'M6 requires professors.school_id (run M2 first)';
  end if;
end
$$;

-- 1. Tenant backstop on booking creation. Preserves the D-011-era ownership
--    check; adds "the professor must be in the student's tenant".
alter policy "users create counseling requests"
  on public.counseling_requests
  with check (
    exists (
      select 1
      from public.profiles p
      where p.id = counseling_requests.student_id
        and p.auth_user_id = (select auth.uid())
        and p.role = 'student'
        and exists (
          select 1
          from public.professors pr
          where pr.id = counseling_requests.professor_id
            and pr.school_id = p.school_id
        )
    )
  );

-- 2. Remove dead cross-role exposure.
drop policy if exists "demo anon update counseling requests"
  on public.counseling_requests;
revoke update on public.counseling_requests from anon;

-- 3. Tenant-scope the assistant answer path.
create or replace function public.answer_professor_questions(
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
  v_staff_profile_id uuid;
  v_staff_role public.user_role;
  v_staff_school_id uuid;
  v_professor_id uuid;
  v_requested_count integer;
  v_authorized_count integer;
  v_answer text := trim(p_answer);
begin
  if v_auth_user_id is null then
    raise exception 'authentication required';
  end if;

  select p.id, p.role, p.school_id, pr.id
    into v_staff_profile_id, v_staff_role, v_staff_school_id, v_professor_id
  from public.profiles p
  left join public.professors pr on pr.profile_id = p.id
  where p.auth_user_id = v_auth_user_id
    and p.role in ('professor', 'assistant');

  if v_staff_profile_id is null then
    raise exception 'question staff profile not found';
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
    and e.status in ('pending', 'assigned')
    and (
      (
        v_staff_role = 'assistant'
        and exists (
          select 1 from public.courses c
          where c.id = e.course_id
            and c.school_id = v_staff_school_id
        )
      )
      or e.professor_id = v_professor_id
    );

  if v_authorized_count <> v_requested_count then
    raise exception 'one or more questions are unavailable or unauthorized';
  end if;

  return query
  update public.escalations e
     set status = 'answered',
         answer = v_answer,
         resolved_at = now(),
         answered_by = v_staff_profile_id,
         answered_at = now(),
         answer_mode = 'manual',
         auto_reply_rule_id = null
   where e.id = any(p_question_ids)
     and e.status in ('pending', 'assigned')
     and (
       (
         v_staff_role = 'assistant'
         and exists (
           select 1 from public.courses c
           where c.id = e.course_id
             and c.school_id = v_staff_school_id
         )
       )
       or e.professor_id = v_professor_id
     )
  returning e.id, e.user_id;
end
$$;

revoke all on function public.answer_professor_questions(uuid[], text) from public;
grant execute on function public.answer_professor_questions(uuid[], text) to authenticated;

commit;
