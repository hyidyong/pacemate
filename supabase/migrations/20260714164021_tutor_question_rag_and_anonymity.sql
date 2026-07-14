begin;

alter table public.escalations
  add column if not exists is_anonymous boolean not null default false;

-- Keep the original six-argument RPC callable for existing forms.  The new
-- overload adds the only new persisted field and delegates all course,
-- enrollment, idempotency, and professor-route checks to the reviewed RPC.
create or replace function public.create_professor_question(
  p_course_id uuid,
  p_category text,
  p_question text,
  p_submission_key uuid,
  p_source_message_id uuid,
  p_source_kind text,
  p_is_anonymous boolean
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
  v_result record;
begin
  select *
    into v_result
  from public.create_professor_question(
    p_course_id,
    p_category,
    p_question,
    p_submission_key,
    p_source_message_id,
    p_source_kind
  );

  if v_result.question_id is null then
    raise exception 'question creation returned no result';
  end if;

  if v_result.was_created then
    update public.escalations
       set is_anonymous = coalesce(p_is_anonymous, false)
     where id = v_result.question_id;
  end if;

  return query
  select
    v_result.question_id,
    v_result.question_status,
    v_result.question_answer,
    v_result.was_created,
    v_result.recipient_profile_id,
    v_result.resolved_source_kind;
end
$$;

revoke all on function public.create_professor_question(uuid, text, text, uuid, uuid, text, boolean) from public;
revoke all on function public.create_professor_question(uuid, text, text, uuid, uuid, text, boolean) from anon;
grant execute on function public.create_professor_question(uuid, text, text, uuid, uuid, text, boolean) to authenticated;

commit;
