# Stage 1 — Slot Mismatch Reproduction (2026-08-11, live demo DB, dev server @ bbd3aa3)

Historical report: "timetable remaining/available slots != counseling remaining/available slots".

## Method

- Canonical source = hand-computed expectation from raw DB rows (service-role REST reads of
  `professor_availability`, `professor_teaching_slots`, `professor_admin_tasks`, `counseling_requests`)
  run through the documented engine rules (see SLOT_DATAFLOW.md).
- Student view = `/counseling` as demo student 김학생 (desktop + 375px mobile).
- Professor view = `/professor` calendar as demo professor 김재두.

## Reproduction matrix

| Case | Canonical source | Timetable/Professor view | Counseling view | Expected | Result |
|---|---|---|---|---|---|
| 박성은, Mon (recurring 09:30–10:00, 15:00–15:30 active) | 2 slots | n/a | 8/17, 8/24 show "2개"; slots 09:30, 15:00 | 2 | **CONSISTENT** |
| 박성은, Tue (10:00–12:00 ×2 dup + 10:30–11:00 overlap + 16:00–16:30 + 16:30–17:00 ×2 dup active; 15:30–16:00 inactive; teaching 09:00–10:30) | 5 slots after dedupe + conflicts | n/a | 8/18, 8/25 show "5개" | 5 | **CONSISTENT** (dedupe of duplicate rows works) |
| 박성은, pending request 2026-07-13 18:30 KST (past) | past → no effect on future slots | shows in 내 상담 요청 "승인 대기" | not blocking future days | no effect | **CONSISTENT** |
| Desktop vs mobile (student `/counseling`) | same | n/a | identical counts 2개/5개 | identical | **CONSISTENT** |
| 김재두 (ZERO `professor_availability` rows, zero requests) — student side | 0 bookable slots | n/a | "선택한 교수님의 바로 신청 가능한 상담 시간이 없습니다" | 0 | **CONSISTENT** |
| 김재두 — professor calendar, same DB state | 0 bookable slots | ~85 chunks "상담 가능" with tooltip "상담 예약이 가능한 시간입니다" (week 8/10–8/14, all free 09:00–18:00 time) | 0 slots | 0 vs ~85 | **MISMATCH REPRODUCED** |

## Verdict on the historical bug

1. **Student-facing mismatch (timetable page vs counseling page): NOT reproducible.** The student
   counseling page matches the canonical engine exactly, including duplicate-row dedupe, teaching
   conflicts, inactive-row blackouts, and past-request handling. Desktop == mobile. The timetable
   registration duplication was unified in commits 72beab8/40bd63e (both `/courses` and mypage go
   through `addCourseToSchedule` + shared `findScheduleConflicts`); regression coverage exists in
   `src/lib/counseling-slots.test.mjs`, `src/services/student-timetable.rules.test.mjs`,
   `src/lib/student-timetable.test.mjs` (all passing). Documented as historical/resolved.

2. **Professor-side availability mismatch: CURRENTLY REPRODUCIBLE** (0 vs ~85 above). Root cause:
   duplicate availability engine `calculateRecommendedAvailability` (`src/lib/calendar-utils.ts:27-157`)
   diverges from the canonical `buildAvailableCounselingSlots`:
   - (R1) counts only `approved` requests as busy (`:77`) — `pending` requests still shown as
     "상담 가능" although the DB exclusion constraint blocks student booking of those times;
   - (R2) inactive-availability blackout matched by chunk-start prefix (`:133-134`) — an inactive
     1-hour row (the calendar's own blackout toggle writes 1-hour rows) only marks its first 30-min
     chunk as 상담 불가; students see the whole hour blocked;
   - (R3) base window hard-coded Mon–Fri 09:00–18:00 / 30-min chunks, ignoring declared
     `professor_availability` windows and `slot_minutes` — undeclared free time is labeled
     "상담 예약이 가능한 시간입니다", which is false for students (this is the 0-vs-85 driver);
   - (R4) browser-local timezone instead of Asia/Seoul.

## Stage 1 scope decision

- R1 and R2 are unambiguous correctness defects under any reading of the calendar's semantics →
  fixed in Stage 1 via Red → Green (see HANDOFF for evidence). Smallest safe changes, both in the
  pure function `calculateRecommendedAvailability`.
- R3 and R4 are rooted in the duplicate-engine design. The 9–18 default grid also serves the
  professor's availability-editing workflow (clicking free chunks to open/block them), so an honest
  fix requires distinguishing "declared bookable" from "free/could be opened" — that is the Stage 2
  single-source-of-truth unification (and Stage 4 for presentation). Documented, NOT fixed in Stage 1.
  Recorded in KNOWN_ISSUES.md.

## Additional baseline finding (not slot-count)

- In 과목별 예약 mode the workspace auto-selects `course.professors[0]` (`counseling-workspace.tsx:190`)
  and offers no picker among a course's multiple professors ("2명 담당" label only); the second
  professor is reachable only through 교수별 검색. UX gap → Stage 4 candidate.
