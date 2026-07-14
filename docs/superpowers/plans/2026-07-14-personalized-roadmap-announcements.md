# Personalized Roadmap, Announcements, and My Page Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a persisted hybrid AI roadmap pipeline and connect professor controls, student announcements, and My Page icon tabs.

**Architecture:** Approved weekly plans remain the immutable baseline. A server-only service normalizes 15 weeks, combines professor settings and onboarding context, calls OpenAI only for validated personalizations, and stores rows per student/offering/week. Existing `posts(course_notice)` remains the only announcement source.

**Tech Stack:** Next.js App Router, React, TypeScript, Tailwind CSS, Supabase Postgres/RLS, server actions, OpenAI Chat Completions, Node test runner.

## Global Constraints

- Use only server-side `OPENAI_API_KEY`; never expose it through a client component or `NEXT_PUBLIC_*`.
- Preserve `course_weekly_plans` as baseline and always return 15 ordered week entries.
- If OpenAI, JSON parsing, or validation fails, store and return the rule-based fallback.
- Verify session role and professor-to-offering ownership on every server read/write.
- Reuse `posts` with `board_key = "course_notice"`; do not create a duplicate notice table.
- New UI must not use solid Tailwind `border*` utilities; use soft backgrounds and `shadow-sm`.
- Preserve mobile timetable `w-full`, compact padding, `break-all`, `line-clamp-2`, and `truncate`.
- Do not stage or overwrite pre-existing dirty worktree files unrelated to the current task.

---

## File structure

- `supabase/migrations/<generated>_personalized_weekly_roadmaps.sql`: additive source/result tables, indexes, triggers, RLS, revoked direct grants.
- `src/types/personalized-weekly-roadmap.ts`: shared types, baseline normalization, OpenAI response validation.
- `src/services/personalized-weekly-roadmap.server.ts`: read-through hybrid generation and persistence.
- `src/services/personalized-weekly-roadmap.actions.ts`: professor preload/upsert actions.
- `src/components/professor/course-roadmap-personalization-form.tsx`: focused professor form.
- `src/lib/professor-navigation.ts`: one course-menu order consumed by workspace and GNB.
- `src/services/course-notices.server.ts`: enrolled-student notice read model.
- `src/components/dashboard/student-announcement-feed.tsx`: dismissible announcement feed.
- `src/app/notices/page.tsx`: cumulative announcement route.
- `src/components/mypage/my-page-section-tabs.tsx`: icon-only tab filter.

### Task 1: Create the roadmap schema and pure shared contracts

**Files:**
- Create: `supabase/migrations/<generated>_personalized_weekly_roadmaps.sql`
- Create: `src/types/personalized-weekly-roadmap.ts`
- Create: `src/types/personalized-weekly-roadmap.test.mjs`

**Consumes:** Existing `course_offerings`, `course_weekly_plans`, `student_courses`, `student_profiles`, `profiles`.

**Produces:** `WeeklyBaseline`, `AiWeeklyRoadmap`, `normalizeWeeklyBaseline`, `validateAiWeeklyRoadmaps`.

- [ ] **Step 1: Write the failing baseline/validator test**

```js
import assert from "node:assert/strict";
import test from "node:test";
import { normalizeWeeklyBaseline, validateAiWeeklyRoadmaps } from "./personalized-weekly-roadmap.ts";

test("normalizes sparse plans into 15 ordered weeks", () => {
  const weeks = normalizeWeeklyBaseline([{ weekNumber: 2, title: "계약", topic: "계약법", content: "청약" }]);
  assert.equal(weeks.length, 15);
  assert.equal(weeks[0].weekNumber, 1);
  assert.equal(weeks[1].title, "계약");
});

test("rejects incomplete AI output", () => {
  assert.equal(validateAiWeeklyRoadmaps([{ weekNumber: 1, personalizedGoal: "x", learningActivities: ["y"], reviewGuide: "z" }]).ok, false);
});
```

- [ ] **Step 2: Run it to verify failure**

Run: `node --test src/types/personalized-weekly-roadmap.test.mjs`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the minimal pure API**

```ts
export type WeeklyBaseline = { weekNumber: number; title: string; topic: string; content: string };
export type AiWeeklyRoadmap = { weekNumber: number; personalizedGoal: string; learningActivities: string[]; reviewGuide: string };

export function normalizeWeeklyBaseline(rows: Partial<WeeklyBaseline>[]): WeeklyBaseline[] {
  const byWeek = new Map(rows.filter((row) => Number.isInteger(row.weekNumber)).map((row) => [row.weekNumber!, row]));
  return Array.from({ length: 15 }, (_, index) => {
    const weekNumber = index + 1;
    const row = byWeek.get(weekNumber);
    return { weekNumber, title: row?.title?.trim() || `${weekNumber}주차 학습`, topic: row?.topic?.trim() || "학습 계획 확인", content: row?.content?.trim() || "교수 승인 계획을 확인하고 학습을 준비하세요." };
  });
}
```

`validateAiWeeklyRoadmaps` must accept exactly 15 rows, ordered 1–15, nonempty goal/review text, and nonempty string activity arrays. Its return type is `{ ok: true; value: AiWeeklyRoadmap[] } | { ok: false; reason: string }`.

- [ ] **Step 4: Generate and author the additive migration**

Run `supabase migration new personalized_weekly_roadmaps` first, then add:
- `course_roadmap_personalization_sources` with unique `offering_id`, professor ID, foundation text, JSON keyword array, notes, positive `source_version`, timestamps.
- `student_personalized_weekly_roadmaps` with unique `(student_id, offering_id, week_number)`, baseline snapshot, personalized goal/activity/review values, version/hash fields, `ready|fallback|failed` generation status, AI flag, timestamps.
- indexes for offering and student/offering/version, existing `public.set_updated_at()` triggers, RLS enabled, and direct grants revoked as in the existing weekly-roadmap migration.

- [ ] **Step 5: Run contract and migration checks**

Run: `node --test src/types/personalized-weekly-roadmap.test.mjs` then `supabase migration list --local`

Expected: tests PASS; generated migration listed. If no local Supabase project exists, report it and do not apply remote SQL.

- [ ] **Step 6: Commit**

```bash
git add src/types/personalized-weekly-roadmap.ts src/types/personalized-weekly-roadmap.test.mjs supabase/migrations/<generated>_personalized_weekly_roadmaps.sql
git commit -m "feat: add personalized roadmap data model"
```

### Task 2: Implement hybrid generation and read-through persistence

**Files:**
- Create: `src/services/personalized-weekly-roadmap.server.ts`
- Create: `src/services/personalized-weekly-roadmap.test.mjs`
- Modify: `src/services/weekly-roadmap.server.ts`

**Consumes:** Task 1 contracts, `createSupabaseAdminClient`, demo session, approved weekly plans, onboarding fields.

**Produces:** `getPersonalizedWeeklyRoadmapForSession(offeringId)` and `getProfessorRoadmapBaselineForOffering(offeringId)`.

- [ ] **Step 1: Write the failing deterministic helper test**

```js
import assert from "node:assert/strict";
import test from "node:test";
import { buildFallbackRoadmaps, shouldRegenerate } from "./personalized-weekly-roadmap.server.ts";

test("fallback marks results and supplies 15 weeks", () => {
  assert.equal(buildFallbackRoadmaps([], 1, "hash").length, 15);
  assert.equal(buildFallbackRoadmaps([], 1, "hash")[0].generationStatus, "fallback");
});
test("version or profile hash changes require regeneration", () => {
  assert.equal(shouldRegenerate({ sourceVersion: 1, onboardingHash: "a", inputHash: "a" }, 2, "a", "a"), true);
});
```

- [ ] **Step 2: Run it to verify failure**

Run: `node --test src/services/personalized-weekly-roadmap.test.mjs`

Expected: FAIL because the service module does not exist.

- [ ] **Step 3: Implement helpers and OpenAI adapter**

```ts
export function shouldRegenerate(saved: { sourceVersion: number; onboardingHash: string; inputHash: string } | null, sourceVersion: number, onboardingHash: string, inputHash: string) {
  return !saved || saved.sourceVersion !== sourceVersion || saved.onboardingHash !== onboardingHash || saved.inputHash !== inputHash;
}

async function callOpenAi(context: RoadmapGenerationContext): Promise<AiWeeklyRoadmap[] | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: "gpt-4o-mini", temperature: 0.1, response_format: { type: "json_object" }, messages: [{ role: "system", content: ROADMAP_SYSTEM_PROMPT }, { role: "user", content: JSON.stringify(context) }] }),
  });
  if (!response.ok) return null;
  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content;
  if (!content) return null;
  const parsed = JSON.parse(content);
  const validation = validateAiWeeklyRoadmaps(parsed.weeks);
  return validation.ok ? validation.value : null;
}
```

The prompt must prohibit invention of dates, grading, attendance, or mandatory work absent from the baseline. Query plans, source, and onboarding in parallel; SHA-256 hash normalized inputs; reuse saved rows only when all hashes/version match. Upsert all 15 rows. Any API/JSON/validation error must return `buildFallbackRoadmaps` without logging secrets or raw onboarding content.

- [ ] **Step 4: Add a narrow compatibility export**

Expose a new delegate from `weekly-roadmap.server.ts`; do not change `getCourseWeeklyPlanForSession` behavior.

- [ ] **Step 5: Run checks**

Run: `node --test src/services/personalized-weekly-roadmap.test.mjs && npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/personalized-weekly-roadmap.server.ts src/services/personalized-weekly-roadmap.test.mjs src/services/weekly-roadmap.server.ts
git commit -m "feat: generate hybrid personalized weekly roadmaps"
```

### Task 3: Add professor source editing and menu-order reuse

**Files:**
- Create: `src/services/personalized-weekly-roadmap.actions.ts`
- Create: `src/components/professor/course-roadmap-personalization-form.tsx`
- Modify: `src/components/professor/professor-workspace.tsx`
- Modify: `src/lib/professor-navigation.ts`
- Modify: `src/components/layout/app-header-professor-safe.tsx`
- Create: `src/lib/professor-navigation.test.mjs`

**Consumes:** Task 1 source table and Task 2 baseline reader.

**Produces:** secure preload/upsert actions and `professorCourseManagementItems`.

- [ ] **Step 1: Write the failing order test**

```js
import assert from "node:assert/strict";
import test from "node:test";
import { professorCourseManagementItems } from "./professor-navigation.ts";

test("puts draft review under roadmap edit and settings last", () => {
  assert.deepEqual(professorCourseManagementItems.map((item) => item.id), ["roadmap-edit", "weekly-plan-preview", "sensitive-request", "course-faq", "course-settings"]);
});
```

- [ ] **Step 2: Run it to verify failure**

Run: `node --test src/lib/professor-navigation.test.mjs`

Expected: FAIL because the shared array is absent.

- [ ] **Step 3: Implement actions**

```ts
"use server";
export async function getProfessorRoadmapPersonalization(offeringId: string) { /* professor session, offering ownership, approved baseline and saved source */ }
export async function saveProfessorRoadmapPersonalization(formData: FormData) { /* validate, ownership, server-side source_version increment, upsert, revalidate */ }
```

Reject invalid IDs, non-professors, non-owned offerings, oversized text, and more than 12 keywords. The action must not trust a client-provided source version.

- [ ] **Step 4: Implement the focused form**

The form selects an owned course/offering, preloads baseline/source after selection, displays only `기초 지식`, `집중 키워드`, and `교수 메모`, and submits `학생 로드맵에 반영` using `useTransition`. Remove the existing `추천 사유` input. Use no solid borders.

- [ ] **Step 5: Centralize the navigation items**

```ts
export const professorCourseManagementItems = [
  { id: "roadmap-edit", label: "내 과목 로드맵 수정", href: "/professor?tab=roadmap&sub=roadmap-edit" },
  { id: "weekly-plan-preview", label: "주간 계획 초안 검토", href: "/professor/weekly-plan-preview" },
  { id: "sensitive-request", label: "민감한 수정 요청", href: "/professor?tab=roadmap&sub=sensitive-request" },
  { id: "course-faq", label: "과목 관련 질문 모음", href: "/professor?tab=roadmap&sub=course-faq" },
  { id: "course-settings", label: "기타 수업 설정", href: "/professor?tab=roadmap&sub=course-settings" },
] as const;
```

Map these IDs to workspace icons and a preview link panel. Make desktop GNB consume this exact array rather than duplicating labels.

- [ ] **Step 6: Run checks and commit**

Run: `node --test src/lib/professor-navigation.test.mjs && npm run typecheck`

Expected: PASS.

```bash
git add src/services/personalized-weekly-roadmap.actions.ts src/components/professor/course-roadmap-personalization-form.tsx src/components/professor/professor-workspace.tsx src/lib/professor-navigation.ts src/lib/professor-navigation.test.mjs src/components/layout/app-header-professor-safe.tsx
git commit -m "feat: manage personalized roadmap sources"
```

### Task 4: Connect announcements to student dashboard, list route, and navigation

**Files:**
- Create: `src/services/course-notices.server.ts`
- Create: `src/components/dashboard/student-announcement-feed.tsx`
- Create: `src/components/dashboard/student-announcement-feed.test.mjs`
- Create: `src/app/notices/page.tsx`
- Modify: `src/app/dashboard/page.tsx`
- Modify: `src/components/dashboard/student-dashboard-content.tsx`
- Modify: `src/components/layout/app-header-professor-safe.tsx`
- Modify if needed: `src/services/course-settings.actions.ts`, `src/components/professor/professor-workspace.tsx`

**Consumes:** existing `addCourseNotice`, `posts(course_notice)`, enrolled courses, notification service.

**Produces:** `listStudentCourseNotices(profileId)`, dashboard feed, and cumulative `/notices` page.

- [ ] **Step 1: Write the failing dismissal test**

```js
import assert from "node:assert/strict";
import test from "node:test";
import { filterVisibleAnnouncements } from "./student-announcement-feed.tsx";

test("shows only ids not dismissed locally", () => {
  assert.deepEqual(filterVisibleAnnouncements([{ id: "a" }, { id: "b" }], new Set(["a"])).map((item) => item.id), ["b"]);
});
```

- [ ] **Step 2: Run it to verify failure**

Run: `node --test src/components/dashboard/student-announcement-feed.test.mjs`

Expected: FAIL because the feed module is absent.

- [ ] **Step 3: Implement enrolled-only reads**

`listStudentCourseNotices` must first get the student's course IDs, then select active `posts` where `board_key = "course_notice"` and `course_id` is in those IDs. Return ID, title, content, created date, course name, and href. Never load every course's notices.

- [ ] **Step 4: Implement feed and route**

```tsx
const DISMISSED_KEY = "pacemate.dismissed-course-notices.v1";
export function StudentAnnouncementFeed({ announcements }: { announcements: StudentAnnouncement[] }) {
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => readDismissedIds());
  const visible = filterVisibleAnnouncements(announcements, dismissedIds);
  return <section className="rounded-2xl bg-white/90 p-4 shadow-sm">{/* links and X actions */}</section>;
}
```

Place it directly after `StudentTodoCard`. Pass the result from the dashboard server page. Add authenticated `/notices` with identical soft-shadow/no-border styling. Add the desktop student GNB link and the mobile course-menu link to the same route.

- [ ] **Step 5: Ensure both professor publishing paths use the shared notice writer**

Keep `공지 등록 및 알림 발송` on `addCourseNotice`. Add or repair `학생 질문 요청을 공지로 등록` to call the same validated helper. On success revalidate `/dashboard` and `/notices`.

- [ ] **Step 6: Run checks and commit**

Run: `node --test src/components/dashboard/student-announcement-feed.test.mjs && npm run typecheck`

Expected: PASS.

```bash
git add src/services/course-notices.server.ts src/components/dashboard/student-announcement-feed.tsx src/components/dashboard/student-announcement-feed.test.mjs src/app/notices/page.tsx src/app/dashboard/page.tsx src/components/dashboard/student-dashboard-content.tsx src/components/layout/app-header-professor-safe.tsx src/components/professor/professor-workspace.tsx src/services/course-settings.actions.ts
git commit -m "feat: show course announcements to students"
```

### Task 5: Add My Page icon tabs without regressing timetable layout

**Files:**
- Create: `src/components/mypage/my-page-section-tabs.tsx`
- Create: `src/components/mypage/my-page-section-tabs.test.mjs`
- Modify: `src/components/mypage/my-page-planner.tsx`

**Consumes:** current timetable, todo persistence, and community panels.

**Produces:** `MyPageSection`, `shouldRenderMyPageSection`, icon-only tab UI.

- [ ] **Step 1: Write the failing tab test**

```js
import assert from "node:assert/strict";
import test from "node:test";
import { shouldRenderMyPageSection } from "./my-page-section-tabs.tsx";

test("all renders every panel while a specific tab renders one", () => {
  assert.equal(shouldRenderMyPageSection("all", "community"), true);
  assert.equal(shouldRenderMyPageSection("todo", "community"), false);
});
```

- [ ] **Step 2: Run it to verify failure**

Run: `node --test src/components/mypage/my-page-section-tabs.test.mjs`

Expected: FAIL because the tab module is absent.

- [ ] **Step 3: Implement icon-only controller**

```tsx
export type MyPageSection = "all" | "timetable" | "todo" | "community";
export const shouldRenderMyPageSection = (active: MyPageSection, section: Exclude<MyPageSection, "all">) => active === "all" || active === section;
export function MyPageSectionTabs({ activeTab, onChange }: { activeTab: MyPageSection; onChange: (tab: MyPageSection) => void }) { /* LayoutGrid, CalendarDays, CheckSquare, MessageSquare buttons with aria-label */ }
```

Active: `bg-blue-50 text-blue-600 shadow-sm`. Inactive: `bg-transparent text-gray-400`. No border utilities or visible text labels.

- [ ] **Step 4: Integrate in the planner**

Add `const [activeTab, setActiveTab] = useState<MyPageSection>("all")` above existing data hooks. Put tabs above timetable. Conditionally render only the timetable, todo, and community root sections; do not conditionally invoke persistence hooks. Preserve all current mobile timetable overflow classes.

- [ ] **Step 5: Run checks and commit**

Run: `node --test src/components/mypage/my-page-section-tabs.test.mjs src/components/mypage/my-page-planner-timetable.test.mjs && npm run typecheck`

Expected: PASS.

```bash
git add src/components/mypage/my-page-section-tabs.tsx src/components/mypage/my-page-section-tabs.test.mjs src/components/mypage/my-page-planner.tsx src/components/mypage/my-page-planner-timetable.test.mjs
git commit -m "feat: filter my page sections with icon tabs"
```

### Task 6: Verify the integrated flow and stale-build recovery

**Files:**
- Modify only files required by a failing test or verified runtime defect.

**Consumes:** Tasks 1–5.

**Produces:** production build evidence and safe cache-recovery instructions.

- [ ] **Step 1: Run focused tests**

Run:

```powershell
node --test src/types/personalized-weekly-roadmap.test.mjs src/services/personalized-weekly-roadmap.test.mjs src/lib/professor-navigation.test.mjs src/components/dashboard/student-announcement-feed.test.mjs src/components/mypage/my-page-section-tabs.test.mjs src/components/mypage/my-page-planner-timetable.test.mjs
```

Expected: all PASS.

- [ ] **Step 2: Run TypeScript and production build**

Run: `npm run typecheck` then `npm run build`

Expected: both exit 0.

- [ ] **Step 3: Browser smoke tests**

Professor: baseline preloads, save succeeds, course submenu order is exact, both notice actions publish. Student: dashboard feed is below todo, dismissal works, `/notices` lists enrolled-course notices, GNB/mobile link work, My Page filters sections, and timetable has no horizontal scroll.

- [ ] **Step 4: If stale chunks remain, remove only build artifacts**

After stopping the dev server:

```powershell
Remove-Item -LiteralPath .next -Recurse -Force
npm run dev
```

Never delete source files, environment files, or user data. Hard-refresh only after the new server is ready.

- [ ] **Step 5: Commit only verification corrections**

```bash
git add <corrected-files>
git commit -m "fix: verify personalized roadmap integration"
```

## Plan self-review

- Coverage: Tasks 1–3 implement the hybrid AI roadmap and professor ordering; Task 4 covers both announcement publishing and student access; Task 5 covers tabs and timetable preservation; Task 6 verifies every requested flow.
- Consistency: Task 1 establishes types for Task 2; Task 2 service is consumed by Task 3; Task 3's menu array is the only course-menu definition.
- Scope: Each task is independently testable and commit-sized; existing unrelated dirty files remain outside staging.

