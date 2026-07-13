begin;

do $$
declare
  required_function regprocedure;
  unexpected_index text;
begin
  foreach required_function in array array[
    'public.create_professor_question(uuid,text,text,uuid,uuid,text)'::regprocedure,
    'public.answer_professor_questions(uuid[],text)'::regprocedure,
    'public.normalize_professor_question(text)'::regprocedure,
    'public.professor_question_fingerprint(text)'::regprocedure
  ] loop
    if not has_function_privilege('anon', required_function, 'EXECUTE') then
      raise exception 'unexpected precondition: anon EXECUTE is already absent on %', required_function;
    end if;
  end loop;

  foreach unexpected_index in array array[
    'escalations_course_id_idx',
    'escalations_answered_by_idx',
    'escalations_auto_reply_rule_id_idx',
    'professor_question_auto_reply_rules_course_id_idx'
  ] loop
    if to_regclass('public.' || unexpected_index) is not null then
      raise exception 'unexpected index collision: %', unexpected_index;
    end if;
  end loop;
end
$$;

revoke execute on function public.create_professor_question(uuid,text,text,uuid,uuid,text)
  from anon;
revoke execute on function public.answer_professor_questions(uuid[],text)
  from anon;
revoke execute on function public.normalize_professor_question(text)
  from anon;
revoke execute on function public.professor_question_fingerprint(text)
  from anon;

create index escalations_course_id_idx
  on public.escalations(course_id);
create index escalations_answered_by_idx
  on public.escalations(answered_by);
create index escalations_auto_reply_rule_id_idx
  on public.escalations(auto_reply_rule_id);
create index professor_question_auto_reply_rules_course_id_idx
  on public.professor_question_auto_reply_rules(course_id);

do $$
declare
  protected_function regprocedure;
  required_index text;
begin
  foreach protected_function in array array[
    'public.create_professor_question(uuid,text,text,uuid,uuid,text)'::regprocedure,
    'public.answer_professor_questions(uuid[],text)'::regprocedure,
    'public.normalize_professor_question(text)'::regprocedure,
    'public.professor_question_fingerprint(text)'::regprocedure
  ] loop
    if has_function_privilege('anon', protected_function, 'EXECUTE') then
      raise exception 'anon EXECUTE remains on %', protected_function;
    end if;
  end loop;

  if not has_function_privilege(
    'authenticated',
    'public.create_professor_question(uuid,text,text,uuid,uuid,text)',
    'EXECUTE'
  ) or not has_function_privilege(
    'authenticated',
    'public.answer_professor_questions(uuid[],text)',
    'EXECUTE'
  ) then
    raise exception 'authenticated question RPC access changed unexpectedly';
  end if;

  foreach required_index in array array[
    'escalations_course_id_idx',
    'escalations_answered_by_idx',
    'escalations_auto_reply_rule_id_idx',
    'professor_question_auto_reply_rules_course_id_idx'
  ] loop
    if to_regclass('public.' || required_index) is null then
      raise exception 'required index was not created: %', required_index;
    end if;
  end loop;
end
$$;

commit;
