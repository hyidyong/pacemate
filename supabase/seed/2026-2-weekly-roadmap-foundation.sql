-- PaceMate 2026-2 weekly roadmap foundation seed proposal.
-- Review/reproduction seed. Applied only through a separately guarded transaction;
-- do not execute blindly against Supabase.
-- Evidence was read from the verified PaceMate project (ref: szztsqdnvenfbgxtylkl).

begin;

do $$
declare
  v_school_id uuid := '862b661c-810a-4440-ba76-722b2fcf8d6a';
  v_term_id uuid;
  v_offering_id uuid;
begin
  -- 2026-2 boundary: the calendar explicitly starts the semester on 2026-09-01
  -- and starts winter break/seasonal semester on 2026-12-21. The day before
  -- that published boundary is used as ends_on; confirm with the registrar.
  select id
    into v_term_id
    from public.academic_terms
   where school_id = v_school_id
     and semester_label = '2026-2';

  if v_term_id is null then
    insert into public.academic_terms (
      school_id,
      semester_label,
      starts_on,
      ends_on,
      timezone,
      total_weeks,
      is_active
    ) values (
      v_school_id,
      '2026-2',
      date '2026-09-01',
      date '2026-12-20',
      'Asia/Seoul',
      15,
      false
    )
    returning id into v_term_id;
  else
    if exists (
      select 1
        from public.academic_terms
       where id = v_term_id
         and (
           starts_on <> date '2026-09-01'
           or ends_on <> date '2026-12-20'
           or timezone <> 'Asia/Seoul'
           or total_weeks <> 15
         )
    ) then
      raise exception 'Existing 2026-2 term has conflicting dates or week count; review before seeding';
    end if;
  end if;

  -- Resolved candidate: courses.name = 회사법, 2026-2 professor mapping and
  -- 2026-2 teaching slots both point to professor 김재두.
  select id
    into v_offering_id
    from public.course_offerings
   where course_id = '6a9d0d8d-7010-4470-8af3-a72e09c59e88'
     and professor_id = '7633254b-18cb-483d-a163-72eee0f22c97'
     and term_id = v_term_id
     and section_label is null;

  if v_offering_id is null then
    insert into public.course_offerings (
      course_id,
      professor_id,
      term_id,
      section_label,
      starts_on,
      ends_on
    ) values (
      '6a9d0d8d-7010-4470-8af3-a72e09c59e88',
      '7633254b-18cb-483d-a163-72eee0f22c97',
      v_term_id,
      null,
      null,
      null
    )
    returning id into v_offering_id;
  end if;

  -- Resolved candidate: courses.name = 행정절차와행정구제, 2026-2 professor
  -- mapping and 2026-2 teaching slots both point to professor 김영수.
  select id
    into v_offering_id
    from public.course_offerings
   where course_id = '72170705-9609-456c-91fd-664b03c5a4ac'
     and professor_id = '022a2f9b-f1ac-473e-a145-8cabd31419e5'
     and term_id = v_term_id
     and section_label is null;

  if v_offering_id is null then
    insert into public.course_offerings (
      course_id,
      professor_id,
      term_id,
      section_label,
      starts_on,
      ends_on
    ) values (
      '72170705-9609-456c-91fd-664b03c5a4ac',
      '022a2f9b-f1ac-473e-a145-8cabd31419e5',
      v_term_id,
      null,
      null,
      null
    )
    returning id into v_offering_id;
  end if;
end
$$;

-- Post-seed review queries. These are intentionally read-only.
select id, school_id, semester_label, starts_on, ends_on, timezone, total_weeks, is_active
  from public.academic_terms
 where school_id = '862b661c-810a-4440-ba76-722b2fcf8d6a'
   and semester_label = '2026-2';

select co.id, co.course_id, c.name as course_name, co.professor_id, p.name as professor_name,
       co.term_id, co.section_label, co.starts_on, co.ends_on
  from public.course_offerings co
  join public.courses c on c.id = co.course_id
  join public.professors p on p.id = co.professor_id
  join public.academic_terms t on t.id = co.term_id
 where t.school_id = '862b661c-810a-4440-ba76-722b2fcf8d6a'
   and t.semester_label = '2026-2'
   and co.course_id in (
     '6a9d0d8d-7010-4470-8af3-a72e09c59e88',
     '72170705-9609-456c-91fd-664b03c5a4ac'
   )
 order by c.name;

select course_id, semester_label, offering_id, count(*) as row_count
  from public.student_courses
 where course_id = '6a9d0d8d-7010-4470-8af3-a72e09c59e88'
 group by course_id, semester_label, offering_id;

commit;
