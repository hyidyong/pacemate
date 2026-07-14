begin;

create policy "assistants read professor questions"
  on public.escalations for select to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.auth_user_id = (select auth.uid())
        and p.role = 'assistant'
    )
  );

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
  v_professor_id uuid;
  v_requested_count integer;
  v_authorized_count integer;
  v_answer text := trim(p_answer);
begin
  if v_auth_user_id is null then
    raise exception 'authentication required';
  end if;

  select p.id, p.role, pr.id
    into v_staff_profile_id, v_staff_role, v_professor_id
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
    and (v_staff_role = 'assistant' or e.professor_id = v_professor_id);

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
     and (v_staff_role = 'assistant' or e.professor_id = v_professor_id)
  returning e.id, e.user_id;
end
$$;

revoke all on function public.answer_professor_questions(uuid[], text) from public;
grant execute on function public.answer_professor_questions(uuid[], text) to authenticated;

commit;
