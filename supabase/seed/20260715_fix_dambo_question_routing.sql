-- Repair 2026-2 "담보물권법" question routing so student escalations reach
-- professor 김재두 instead of the legacy 박성은 assignment.
--
-- This is a data-repair seed, not an automatic migration. Review and run only
-- when the target project matches the expected demo/operational dataset.

begin;

do $$
declare
  v_course_id uuid := '0b452ae6-8578-45b2-8a42-4373064ebed6';
  v_term_id uuid := '783bfca3-3dae-400c-b6e8-08683c4ba3db';
  v_target_professor_id uuid := '7633254b-18cb-483d-a163-72eee0f22c97';
  v_target_profile_id uuid;
  v_previous_professor_id uuid;
  v_reassigned_count integer := 0;
begin
  select profile_id
    into v_target_profile_id
  from public.professors
  where id = v_target_professor_id
    and name = '김재두';

  if v_target_profile_id is null then
    raise exception 'Target professor 김재두 is not linked to a profile';
  end if;

  select professor_id
    into v_previous_professor_id
  from public.course_offerings
  where course_id = v_course_id
    and term_id = v_term_id;

  if v_previous_professor_id is null then
    raise exception 'No 2026-2 offering exists for 담보물권법';
  end if;

  insert into public.course_professors (course_id, professor_id, semester_label)
  values (v_course_id, v_target_professor_id, '2026-2')
  on conflict (course_id, professor_id, semester_label) do nothing;

  update public.course_offerings
     set professor_id = v_target_professor_id,
         updated_at = now()
   where course_id = v_course_id
     and term_id = v_term_id
     and professor_id <> v_target_professor_id;

  update public.escalations
     set professor_id = v_target_professor_id,
         assigned_to = v_target_profile_id
   where course_id = v_course_id
     and professor_id = v_previous_professor_id
     and status in ('pending', 'assigned');

  get diagnostics v_reassigned_count = row_count;

  if v_reassigned_count > 0 and not exists (
    select 1
    from public.user_notifications
    where recipient_id = v_target_profile_id
      and category = 'question'
      and title = '새 교수 질문'
      and target_href = '/professor?tab=questions&sub=incoming-questions'
      and is_read = false
      and created_at >= now() - interval '1 day'
  ) then
    insert into public.user_notifications (
      recipient_role,
      recipient_id,
      target_group,
      category,
      title,
      body,
      target_href,
      is_read
    ) values (
      null,
      v_target_profile_id,
      'PROFESSOR',
      'question',
      '새 교수 질문',
      '담당 과목에 새 질문이 등록되었습니다.',
      '/professor?tab=questions&sub=incoming-questions',
      false
    );
  end if;
end
$$;

commit;
