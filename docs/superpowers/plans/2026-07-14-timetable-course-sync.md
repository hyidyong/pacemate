# 시간표 과목·수강 연동 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 정규 과목의 자동·복수 시간표 등록과 수동 커스텀 과목을 구현하고, 수강 관계를 로드맵·교수 공지에 즉시 연동한다.

**Architecture:** `student_courses`는 정규 수강 관계의 단일 기준으로 유지한다. 정규·커스텀 과목의 수업 시간은 각각의 슬롯 테이블에 저장하고, 서버 서비스가 시간 원본 우선순위를 해석한 뒤 UI용 통합 표시 모델을 반환한다.

**Tech Stack:** Next.js App Router 15, React 19, TypeScript 5, Supabase Postgres/RLS, Node 24 `node:test`, Tailwind CSS 4.

## Global Constraints

- 정규 시간 원본은 `course_schedules`, `professor_teaching_slots`, 사용자 입력 순으로 사용한다.
- 정규 수강 관계는 학생·과목당 중복하지 않으며 수업 회차만 슬롯 행으로 복수 저장한다.
- 수동 커스텀 과목은 시간표 전용이고 로드맵·공지 수강생 목록에 포함하지 않는다.
- 새 UI는 파스텔 카드·둥근 모서리·`shadow-sm` 중심으로 만들고 굵은 외곽선은 사용하지 않는다.
- 모든 새 public 테이블에는 RLS, 소유권 정책, 필요한 인덱스를 둔다.

---

### Task 1: 시간 원본 규칙

**Files:**
- Create: `src/services/student-timetable.rules.ts`
- Create: `src/services/student-timetable.rules.test.mjs`

**Interfaces:**
- Produces: `resolveScheduleSource`, `toKoreanWeekday`, `validateScheduleSlots`.
- Consumes: `{ dayOfWeek: string | number; startTime: string; endTime: string; classroom?: string | null }`.

- [ ] **Step 1: Write the failing test**

```js
test("prefers syllabus slots", () => {
  const result = resolveScheduleSource([{ dayOfWeek: "목", startTime: "09:00", endTime: "10:15" }], [{ dayOfWeek: 1, startTime: "13:00", endTime: "14:15" }], []);
  assert.equal(result.source, "syllabus");
  assert.equal(result.slots.length, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/services/student-timetable.rules.test.mjs`

Expected: FAIL because the rules module is missing.

- [ ] **Step 3: Write minimal implementation**

```ts
export function resolveScheduleSource(syllabus, professor, manual) {
  const [source, slots] = syllabus.length ? ["syllabus", syllabus] : professor.length ? ["professor", professor] : ["manual", manual];
  return { source, slots: validateScheduleSlots(slots) };
}
```

Implement numeric weekday conversion, invalid-time rejection, and duplicate day/time removal.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/services/student-timetable.rules.test.mjs`

Expected: PASS for syllabus precedence, professor/manual fallbacks, conversion, validation, and de-duplication.

- [ ] **Step 5: Commit**

```bash
git add src/services/student-timetable.rules.ts src/services/student-timetable.rules.test.mjs
git commit -m "test: cover timetable schedule resolution"
```

### Task 2: 슬롯·커스텀 과목 스키마

**Files:**
- Create: `supabase/migrations/20260714150000_add_student_timetable_slots.sql`
- Create: `supabase/migrations/student_timetable_slots.test.mjs`

**Interfaces:**
- Consumes: `student_courses(id, student_id, schedule_day, start_time, end_time, classroom)`.
- Produces: `student_course_schedule_slots`, `student_custom_courses`, `student_custom_course_schedule_slots`.

- [ ] **Step 1: Write the failing schema test**

```js
assert.match(sql, /student_course_id uuid not null references public\.student_courses\(id\) on delete cascade/i);
assert.match(sql, /create table .*student_custom_courses/i);
assert.match(sql, /enable row level security/i);
assert.match(sql, /insert into public\.student_course_schedule_slots/i);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test supabase/migrations/student_timetable_slots.test.mjs`

Expected: FAIL because the migration is missing.

- [ ] **Step 3: Write minimal migration**

Create it with `supabase migration new add_student_timetable_slots`. Add regular and custom parent/slot tables, time-order and unique-slot checks, cascade foreign keys, indexes, authenticated grants, RLS ownership policies, and a conflict-safe `legacy` slot backfill from valid single schedule columns.

- [ ] **Step 4: Run migration and schema test**

Run: `supabase migration list --local; node --test supabase/migrations/student_timetable_slots.test.mjs`

Expected: the local migration is listed and all schema assertions PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations
git commit -m "feat: add normalized student timetable slots"
```

### Task 3: 서비스·서버 액션·표시 모델

**Files:**
- Create: `src/services/student-timetable.service.ts`
- Create: `src/services/student-timetable.service.test.mjs`
- Modify: `src/services/student-community.actions.ts`
- Modify: `src/services/student-community.service.ts`
- Modify: `src/lib/student-timetable.ts`

**Interfaces:**
- Consumes: Task 1 rules and Task 2 tables.
- Produces: `TimetableCourseRecord`, `syncCatalogCourseSchedule`, `createCustomTimetableCourse`, `getStudentTimetable`.

- [ ] **Step 1: Write failing service contract tests**

```js
assert.match(source, /from\("course_schedules"\)/);
assert.match(source, /from\("professor_teaching_slots"\)/);
assert.match(source, /delete\(\)\.eq\("student_course_id", studentCourseId\)/);
assert.match(source, /from\("student_custom_courses"\)/);
assert.match(actions, /revalidatePath\("\/notices"\)/);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test src/services/student-timetable.service.test.mjs`

Expected: FAIL because timetable service and notice revalidation are absent.

- [ ] **Step 3: Implement minimal service**

Read all `course_schedules` first and `professor_teaching_slots` only if none exist. Resolve and validate slots, replace a regular course's slots atomically, and return one display record per slot. Allow manual regular slots only with no automatic source. Add custom create/delete actions. Revalidate `/mypage`, `/dashboard`, `/roadmap`, `/notices` after regular writes.

- [ ] **Step 4: Run tests and type checking**

Run: `node --test src/services/student-timetable.rules.test.mjs src/services/student-timetable.service.test.mjs; npm run typecheck`

Expected: all tests PASS and TypeScript exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/services src/lib/student-timetable.ts
git commit -m "feat: sync timetable slots with student courses"
```

### Task 4: 다중 요일 UI와 대시보드

**Files:**
- Modify: `src/components/mypage/my-page-planner.tsx`
- Modify: `src/components/dashboard/today-timetable-widget.tsx`
- Modify: `src/components/dashboard/student-dashboard-content.tsx`
- Create: `src/components/mypage/my-page-planner.test.mjs`

**Interfaces:**
- Consumes: `TimetableCourseRecord[]` and Task 3 actions.
- Produces: 자동 슬롯 카드, 수동 회차 추가·삭제 편집기, 커스텀 과목 폼, 슬롯별 블록.

- [ ] **Step 1: Write failing UI contract test**

```js
assert.match(source, /자동 시간표/);
assert.match(source, /요일 추가/);
assert.match(source, /createCustomTimetableCourse/);
assert.doesNotMatch(source, /border-2/);
assert.match(source, /shadow-sm/);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/components/mypage/my-page-planner.test.mjs`

Expected: FAIL because multi-slot and custom UI are absent.

- [ ] **Step 3: Implement minimal UI**

Render one block per slot and remove all blocks through the parent entry. For regular courses show automatic slots in read-only pastel cards; display a multi-select editor only when automatic data is absent. For custom courses require a title and at least one day/time/classroom row. Use `shadow-sm` pastel cards rather than outer borders.

- [ ] **Step 4: Run UI test and build checks**

Run: `node --test src/components/mypage/my-page-planner.test.mjs; npm run typecheck; npm run build`

Expected: UI test PASS, typecheck exits 0, build exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/components/mypage src/components/dashboard
git commit -m "feat: add multi-slot timetable course UI"
```

### Task 5: 연동 회귀·브라우저 QA

**Files:**
- Modify: `src/components/roadmap/student-roadmap-workspace.test.mjs`
- Create: `docs/qa/2026-07-14-timetable-course-sync.md`

**Interfaces:**
- Consumes: regular `student_courses`; custom tables must remain absent from roadmap and notice queries.
- Produces: reproducible QA record.

- [ ] **Step 1: Write regression assertions**

```js
assert.match(roadmapSource, /from\("student_courses"\)/);
assert.doesNotMatch(roadmapSource, /student_custom_courses/);
assert.match(noticeSource, /from\("student_courses"\)/);
assert.doesNotMatch(noticeSource, /student_custom_courses/);
```

- [ ] **Step 2: Run regression tests**

Run: `node --test src/components/roadmap/student-roadmap-workspace.test.mjs`

Expected: PASS, proving only regular enrollment drives roadmap and notices.

- [ ] **Step 3: Perform browser QA**

Run `npm run dev`; verify a syllabus-backed 목/금 course creates two blocks, resync replaces a stale slot, manual regular input accepts two rows, a custom course stays timetable-only, and deleting a regular course removes roadmap/notice access. Record actual observations and blockers.

- [ ] **Step 4: Run full verification**

Run: `node --test src/**/*.test.mjs; npm run typecheck; npm run build`

Expected: all automated checks and production build exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/components/roadmap/student-roadmap-workspace.test.mjs docs/qa/2026-07-14-timetable-course-sync.md
git commit -m "test: verify timetable course cascade"
```
