-- PaceMate 2026-2 company-law synthetic student progress reference seed.
-- Separate from migrations and report queries; never execute on application startup.

begin;

do $$
declare
  v_course_id uuid;
  v_offering_id uuid;
  v_count integer;
  v_plan_count integer;
  v_distinct_week_count integer;
  v_in_range_week_count integer;
  v_approved_plan_count integer;
  v_target_course_progress_count integer;
  v_target_weekly_progress_count integer;
  v_non_target_course_progress_count integer;
  v_non_target_weekly_progress_count integer;
  v_private_note_count integer;
  v_ai_private_note_count integer;
  v_invalid_share_count integer;
  v_non_student5_feedback_count integer;
  v_target_private_null_count integer;
  v_target_ai_false_count integer;
  v_shared_feedback_count integer;
  v_shared_week_mismatch_count integer;
  v_summary_mismatch_count integer;
  v_student record;
begin
  select count(*) into v_count from public.profiles
   where identifier in ('student1@pacemate.edu', 'student2@pacemate.edu',
     'student3@pacemate.edu', 'student4@pacemate.edu', 'student5@pacemate.edu');
  if v_count <> 5 then
    raise exception 'Expected exactly five demo student profiles; found %', v_count;
  end if;

  select count(*) into v_count from public.profiles
   where identifier in ('student1@pacemate.edu', 'student2@pacemate.edu',
     'student3@pacemate.edu', 'student4@pacemate.edu', 'student5@pacemate.edu')
     and role = 'student';
  if v_count <> 5 then
    raise exception 'All five demo profiles must have role student; found %', v_count;
  end if;

  select count(*) into v_count from public.courses where name = '회사법';
  if v_count <> 1 then
    raise exception 'Expected exactly one course named 회사법; found %', v_count;
  end if;
  select id into v_course_id from public.courses where name = '회사법';

  select count(*) into v_count
    from public.course_offerings co
    join public.academic_terms t on t.id = co.term_id
   where co.course_id = v_course_id and t.semester_label = '2026-2';
  if v_count <> 1 then
    raise exception 'Expected exactly one 2026-2 company-law offering; found %', v_count;
  end if;
  select co.id into v_offering_id
    from public.course_offerings co
    join public.academic_terms t on t.id = co.term_id
   where co.course_id = v_course_id and t.semester_label = '2026-2';

  select count(*), count(distinct week_number),
         count(*) filter (where week_number between 1 and 15),
         count(*) filter (where review_required = false and professor_confirmed = true)
    into v_plan_count, v_distinct_week_count, v_in_range_week_count, v_approved_plan_count
    from public.course_weekly_plans where offering_id = v_offering_id;
  if v_plan_count <> 15 or v_distinct_week_count <> 15
     or v_in_range_week_count <> 15 or v_approved_plan_count <> 15 then
    raise exception 'Company-law plan invariant failed: total %, distinct %, in-range %, approved %',
      v_plan_count, v_distinct_week_count, v_in_range_week_count, v_approved_plan_count;
  end if;

  select count(*) into v_target_course_progress_count
    from public.student_course_progress scp join public.profiles p on p.id = scp.student_id
   where scp.offering_id = v_offering_id and p.identifier in (
     'student1@pacemate.edu', 'student2@pacemate.edu', 'student3@pacemate.edu',
     'student4@pacemate.edu', 'student5@pacemate.edu');
  select count(*) into v_target_weekly_progress_count
    from public.student_weekly_progress swp join public.profiles p on p.id = swp.student_id
   where swp.offering_id = v_offering_id and p.identifier in (
     'student1@pacemate.edu', 'student2@pacemate.edu', 'student3@pacemate.edu',
     'student4@pacemate.edu', 'student5@pacemate.edu');
  if v_target_course_progress_count <> 0 or v_target_weekly_progress_count <> 0 then
    raise exception 'Target progress already exists: course %, weekly %',
      v_target_course_progress_count, v_target_weekly_progress_count;
  end if;

  select count(*) into v_non_target_course_progress_count
    from public.student_course_progress scp
   where scp.student_id not in (select p.id from public.profiles p where p.identifier in (
     'student1@pacemate.edu', 'student2@pacemate.edu', 'student3@pacemate.edu',
     'student4@pacemate.edu', 'student5@pacemate.edu'));
  select count(*) into v_non_target_weekly_progress_count
    from public.student_weekly_progress swp
   where swp.student_id not in (select p.id from public.profiles p where p.identifier in (
     'student1@pacemate.edu', 'student2@pacemate.edu', 'student3@pacemate.edu',
     'student4@pacemate.edu', 'student5@pacemate.edu'));

  insert into public.student_weekly_progress (
    student_id, offering_id, week_number, progress_status_override,
    difficulty_level, understanding_level, private_note, shared_feedback,
    share_feedback_with_professor, use_private_note_for_ai)
  select p.id, v_offering_id, d.week_number,
    case
      when d.identifier = 'student1@pacemate.edu' then 'covered'
      when d.identifier = 'student2@pacemate.edu' and d.week_number in (5, 9) then 'needs_review'
      when d.identifier = 'student2@pacemate.edu' and d.week_number >= 13 then 'in_progress'
      when d.identifier = 'student2@pacemate.edu' then 'covered'
      when d.identifier = 'student3@pacemate.edu' and d.week_number <= 6 then 'covered'
      when d.identifier = 'student3@pacemate.edu' and d.week_number <= 9 then 'in_progress'
      when d.identifier = 'student3@pacemate.edu' then 'not_started'
      when d.identifier = 'student4@pacemate.edu' and d.week_number <= 3 then 'covered'
      when d.identifier = 'student4@pacemate.edu' and d.week_number <= 12 then 'needs_review'
      when d.identifier = 'student4@pacemate.edu' then 'in_progress'
      when d.identifier = 'student5@pacemate.edu' and d.week_number <= 10 then 'covered'
      else 'in_progress' end,
    case
      when d.identifier = 'student1@pacemate.edu' then case when d.week_number % 2 = 0 then 2 else 3 end
      when d.identifier = 'student2@pacemate.edu' then case when d.week_number % 2 = 0 then 4 else 3 end
      when d.identifier = 'student3@pacemate.edu' then 4
      when d.identifier = 'student4@pacemate.edu' then case when d.week_number % 2 = 0 then 5 else 4 end
      else case when d.week_number % 2 = 0 then 3 else 2 end end,
    case
      when d.identifier = 'student1@pacemate.edu' then case when d.week_number % 2 = 0 then 5 else 4 end
      when d.identifier = 'student2@pacemate.edu' then case when d.week_number % 2 = 0 then 3 else 4 end
      when d.identifier = 'student3@pacemate.edu' then case when d.week_number % 2 = 0 then 2 else 3 end
      when d.identifier = 'student4@pacemate.edu' then case when d.week_number % 2 = 0 then 2 else 3 end
      else case when d.week_number % 2 = 0 then 4 else 3 end end,
    null,
    case when d.identifier = 'student5@pacemate.edu' and d.week_number = 5 then '복습 자료를 확인했습니다.'
         when d.identifier = 'student5@pacemate.edu' and d.week_number = 12 then '다음 주차 질문을 남깁니다.'
         else null end,
    d.identifier = 'student5@pacemate.edu' and d.week_number in (5, 12), false
    from (select targets.identifier, weeks.week_number
      from (values ('student1@pacemate.edu'), ('student2@pacemate.edu'),
        ('student3@pacemate.edu'), ('student4@pacemate.edu'), ('student5@pacemate.edu'))
        as targets(identifier)
      cross join generate_series(1, 15) as weeks(week_number)) as d
    join public.profiles p on p.identifier = d.identifier where p.role = 'student';

  insert into public.student_course_progress (
    student_id, offering_id, last_completed_week, status, last_activity_at)
  select p.id, v_offering_id, s.last_completed_week, s.status,
    timestamptz '2026-07-13 09:00:00+09'
    from (values ('student1@pacemate.edu', 15, 'completed'),
      ('student2@pacemate.edu', 12, 'needs_review'),
      ('student3@pacemate.edu', 6, 'in_progress'),
      ('student4@pacemate.edu', 3, 'needs_review'),
      ('student5@pacemate.edu', 10, 'in_progress'))
      as s(identifier, last_completed_week, status)
    join public.profiles p on p.identifier = s.identifier where p.role = 'student';

  select count(*) into v_count from public.student_course_progress scp join public.profiles p on p.id = scp.student_id
   where scp.offering_id = v_offering_id and p.identifier in (
     'student1@pacemate.edu', 'student2@pacemate.edu', 'student3@pacemate.edu',
     'student4@pacemate.edu', 'student5@pacemate.edu');
  if v_count <> 5 then raise exception 'Expected five target course progress rows; found %', v_count; end if;

  select count(*) into v_count from public.student_weekly_progress swp join public.profiles p on p.id = swp.student_id
   where swp.offering_id = v_offering_id and p.identifier in (
     'student1@pacemate.edu', 'student2@pacemate.edu', 'student3@pacemate.edu',
     'student4@pacemate.edu', 'student5@pacemate.edu');
  if v_count <> 75 then raise exception 'Expected 75 target weekly progress rows; found %', v_count; end if;

  for v_student in select * from (values ('student1@pacemate.edu'), ('student2@pacemate.edu'),
    ('student3@pacemate.edu'), ('student4@pacemate.edu'), ('student5@pacemate.edu')) as target(identifier)
  loop
    select count(*) into v_count from public.student_weekly_progress swp join public.profiles p on p.id = swp.student_id
     where swp.offering_id = v_offering_id and p.identifier = v_student.identifier;
    if v_count <> 15 then raise exception 'Expected 15 weekly rows for %; found %', v_student.identifier, v_count; end if;
  end loop;

  select count(*) filter (where swp.private_note is not null),
    count(*) filter (where swp.use_private_note_for_ai <> false),
    count(*) filter (where swp.share_feedback_with_professor and swp.shared_feedback is null),
    count(*) filter (where swp.shared_feedback is not null and p.identifier <> 'student5@pacemate.edu'),
    count(*) filter (where swp.private_note is null),
    count(*) filter (where swp.use_private_note_for_ai = false),
    count(*) filter (where swp.shared_feedback is not null),
    count(*) filter (where
      (p.identifier = 'student5@pacemate.edu' and swp.week_number in (5, 12)
        and (swp.shared_feedback is null or swp.share_feedback_with_professor = false))
      or
      (not (p.identifier = 'student5@pacemate.edu' and swp.week_number in (5, 12))
        and (swp.shared_feedback is not null or swp.share_feedback_with_professor = true)))
    into v_private_note_count, v_ai_private_note_count, v_invalid_share_count,
      v_non_student5_feedback_count, v_target_private_null_count, v_target_ai_false_count,
      v_shared_feedback_count, v_shared_week_mismatch_count
    from public.student_weekly_progress swp join public.profiles p on p.id = swp.student_id
   where swp.offering_id = v_offering_id and p.identifier in (
     'student1@pacemate.edu', 'student2@pacemate.edu', 'student3@pacemate.edu',
     'student4@pacemate.edu', 'student5@pacemate.edu');
  if v_private_note_count <> 0 or v_ai_private_note_count <> 0
     or v_invalid_share_count <> 0 or v_non_student5_feedback_count <> 0
     or v_target_private_null_count <> 75 or v_target_ai_false_count <> 75
     or v_shared_feedback_count <> 2 or v_shared_week_mismatch_count <> 0 then
    raise exception 'Private/shared invariants failed: private %, ai %, invalid share %, non-student5 feedback %, null private %, false ai %, shared count %, shared week mismatch %',
      v_private_note_count, v_ai_private_note_count, v_invalid_share_count, v_non_student5_feedback_count,
      v_target_private_null_count, v_target_ai_false_count, v_shared_feedback_count, v_shared_week_mismatch_count;
  end if;

  select count(*) into v_summary_mismatch_count
    from public.student_course_progress scp join public.profiles p on p.id = scp.student_id
    join (values ('student1@pacemate.edu', 15, 'completed'), ('student2@pacemate.edu', 12, 'needs_review'),
      ('student3@pacemate.edu', 6, 'in_progress'), ('student4@pacemate.edu', 3, 'needs_review'),
      ('student5@pacemate.edu', 10, 'in_progress')) as expected(identifier, last_completed_week, status)
      on expected.identifier = p.identifier
   where scp.offering_id = v_offering_id
     and (scp.last_completed_week <> expected.last_completed_week or scp.status <> expected.status);
  if v_summary_mismatch_count <> 0 then
    raise exception 'Course summary postcondition failed for % row(s)', v_summary_mismatch_count;
  end if;

  select count(*) into v_count from public.student_course_progress scp
   where scp.student_id not in (select p.id from public.profiles p where p.identifier in (
     'student1@pacemate.edu', 'student2@pacemate.edu', 'student3@pacemate.edu',
     'student4@pacemate.edu', 'student5@pacemate.edu'));
  if v_count <> v_non_target_course_progress_count then
    raise exception 'Non-target course progress count changed from % to %', v_non_target_course_progress_count, v_count;
  end if;
  select count(*) into v_count from public.student_weekly_progress swp
   where swp.student_id not in (select p.id from public.profiles p where p.identifier in (
     'student1@pacemate.edu', 'student2@pacemate.edu', 'student3@pacemate.edu',
     'student4@pacemate.edu', 'student5@pacemate.edu'));
  if v_count <> v_non_target_weekly_progress_count then
    raise exception 'Non-target weekly progress count changed from % to %', v_non_target_weekly_progress_count, v_count;
  end if;
end
$$;

-- Read-only verification output. No Auth, profile, student_courses, curriculum,
-- graduation, professor, or report data is modified here.
select p.identifier, scp.offering_id, scp.last_completed_week, scp.status,
  count(swp.id) as weekly_progress_count,
  count(*) filter (where swp.progress_status_override = 'covered') as covered_count,
  count(*) filter (where swp.progress_status_override = 'in_progress') as in_progress_count,
  count(*) filter (where swp.progress_status_override = 'needs_review') as needs_review_count,
  count(*) filter (where swp.share_feedback_with_professor) as shared_feedback_count
from public.profiles p
join public.student_course_progress scp on scp.student_id = p.id
join public.student_weekly_progress swp on swp.student_id = p.id and swp.offering_id = scp.offering_id
where p.identifier in ('student1@pacemate.edu', 'student2@pacemate.edu',
  'student3@pacemate.edu', 'student4@pacemate.edu', 'student5@pacemate.edu')
group by p.identifier, scp.offering_id, scp.last_completed_week, scp.status
order by p.identifier;

commit;
