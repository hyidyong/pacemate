# Known Issues

Issues must be added only when reproduced or supported by repository/runtime evidence.
Historical reports may be investigated but are not automatically considered currently reproducible bugs.

## KI-001 — Professor calendar availability engine diverges from canonical student engine

Status: PARTIALLY FIXED in Stage 1 (2026-08-11); remainder deferred to Stage 2.
Evidence: docs/upgrade/stage-01/SLOT_BUG_REPRODUCTION.md (0 vs ~85 slot mismatch reproduced live).

`calculateRecommendedAvailability` (src/lib/calendar-utils.ts) is a second availability
implementation, independent of the canonical `buildAvailableCounselingSlots` (src/lib/counseling-slots.ts).

Fixed in Stage 1 (Red → Green, tests in src/lib/calendar-utils.test.mjs):
- pending counseling requests now block calendar chunks (previously only approved);
- inactive availability rows now black out every chunk they cover (previously prefix-matched
  only the first 30-min chunk).

Remaining (Stage 2 scope — DO NOT patch display counts):
- base window is hard-coded Mon–Fri 09:00–18:00 / 30-min chunks and labels ALL free time
  "상담 가능/상담 예약이 가능한 시간입니다", although students can only book declared
  `professor_availability` windows. A professor with zero availability rows sees a full week of
  "상담 가능" while students see none. Honest fix = single-source-of-truth unification plus a UI
  distinction between "declared bookable" and "free/could be opened" (Stage 2 + Stage 4).
- browser-local timezone (`Date.getDay/getHours`) instead of Asia/Seoul (also
  src/lib/scheduling-policy.ts, today-timetable-widget.tsx). Correct only in KST browsers.

## KI-002 — 3 stale source-regex tests fail on the baseline

Status: OPEN (pre-existing on bbd3aa3; not behavior bugs).
`node --test "src/**/*.test.mjs"` → 144 tests, 141 pass, 3 fail:
- src/services/admin-notifications.test.mjs ×2 — assert exact source strings that changed when
  broadcast dedup / notification dedupe features were added later.
- src/services/question-notice-workflow.test.mjs ×1 — expects `from("chat_messages")` in a file
  refactored since.
These freeze implementation text, not behavior. Triage in a later stage: rewrite as behavior
assertions or update the regexes deliberately.

## KI-003 — Fetch failures render as empty states (indistinguishable from no data)

Status: OPEN. Evidence: page-level `.catch(() => defaults)` in counseling/page.tsx:12-15,
mypage/page.tsx:16-29, app-shell.tsx:35-42; runtime console showed RLS "permission denied"
(posts, student_custom_courses) and one 500 swallowed into empty UI on 2026-08-11.
Dashboard cards "과목 · 학기 완료 근거"/"다음 학습 추천" showed error fallbacks for the demo
student (cause UNVERIFIED — likely demo-data state). Related: role-mismatched queries still
executed (professor session querying student tables). Stage 2/9 candidate.

## KI-004 — Counseling UX correctness edges (documented baseline, Stage 2/4 candidates)

Status: OPEN.
- Counseling workspace month calendar derives its month from the first slot and cannot page
  months; slots in the following month invisible (counseling-workspace.tsx:88-119).
- After booking, the client does not refresh (`router.refresh()` absent) — slot list/requests
  panel stale until navigation (counseling-workspace.tsx:173-179).
- 과목별 예약 mode auto-selects `course.professors[0]`; no picker for a course's other
  professors (counseling-workspace.tsx:190) — second professor reachable only via 교수별 검색.
- Demo student login lands on /onboarding although onboarding data exists (cause UNVERIFIED).

## KI-005 — supabase/schema.sql snapshot has a duplicate column line

Status: OPEN (latent). `professor_admin_tasks` in supabase/schema.sql (~:910-911) repeats
`day_of_week` — harmless unless the snapshot is re-applied verbatim; real migration
(20260714204100) is correct.
