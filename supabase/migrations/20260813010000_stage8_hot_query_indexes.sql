-- Stage 8 P1-3 — indexes justified by named hot queries.
--
-- Every index below has a specific query behind it (cited). Candidates without
-- a query that would use them were deliberately NOT added; see
-- docs/upgrade/stage-08/IMPLEMENTATION_PLAN.md §5 for the exclusions and why.
--
-- CREATE INDEX (not CONCURRENTLY) because Supabase runs migrations inside a
-- transaction and CONCURRENTLY cannot run there. At current volume (largest
-- table ~126 rows) the lock is negligible. A future migration against
-- production-scale tables must be written differently — split out and run
-- CONCURRENTLY outside a transaction.

-- 1. student_weekly_progress (offering_id, week_number)
--    Serves the offering-driven reads in
--    professor-anonymous-weekly-aggregate.server.ts (~:303),
--    course-term-completion-eligibility.server.ts (~:187) and
--    student-course-study-guide.server.ts (~:239).
--    There is no non-partial index leading with offering_id today: the only
--    offering_id index (20260714223924) is partial on feedback columns and
--    cannot serve reads without that predicate, so these queries scan what is
--    projected to become the largest table in the system.
create index if not exists student_weekly_progress_offering_week_idx
  on public.student_weekly_progress (offering_id, week_number);

-- 2. counseling_requests (student_id, created_at desc)
--    Serves counseling.service.ts getStudentRequests (student_id + order
--    created_at desc limit 12) and dashboard/page.tsx (limit 20). Today
--    counseling_requests_student_id_idx satisfies the filter but forces an
--    explicit sort. Confirms the KI-016 candidate.
create index if not exists counseling_requests_student_created_idx
  on public.counseling_requests (student_id, created_at desc);

-- 3. posts (school_id, community_type, status, created_at desc)
--    Serves the community feed in student-community.service.ts (~:323):
--    school_id + community_type + status ordered by created_at desc limit 80.
--    The best existing index (posts_community_type_status_created_idx) omits
--    school_id, so the scan crosses every tenant's posts to fill 80 rows —
--    cost multiplied by tenant count.
create index if not exists posts_school_community_status_created_idx
  on public.posts (school_id, community_type, status, created_at desc);

-- 4. escalations (professor_id, created_at desc)
--    Serves the question inbox in professor-questions.server.ts (~:125):
--    professor_id filter ordered by created_at desc. The existing
--    professor/category/status index cannot provide that ordering, so the sort
--    is explicit. (The unbounded/unfiltered assistant-admin branch of that
--    query is a separate, documented issue — see KNOWN_ISSUES.)
create index if not exists escalations_professor_created_idx
  on public.escalations (professor_id, created_at desc);
