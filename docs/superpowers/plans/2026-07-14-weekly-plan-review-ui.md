# Weekly Plan Review UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 교수용 주간 계획 초안 검토 화면을 테두리 없는 소프트 섀도우 카드 UI로 정리하고, 1~15주차 제목·내용 인라인 편집과 최종 승인 액션을 제공한다.

**Architecture:** 서버 페이지는 인증과 초안 조회를 담당하고, `WeeklyPlanReviewEditor` Client Component가 주차별 편집 상태와 화면 상호작용을 담당한다. 기존 `approveWeeklyPlan` Server Action은 하단의 단일 최종 승인 버튼에 연결하며, 실제 주차 수정 저장 API가 없는 현재 구조에서는 수정 내용을 로컬 검토 상태로 유지하고 승인 시 기존 승인 흐름을 사용한다.

**Tech Stack:** Next.js 15 App Router, React, TypeScript, Tailwind CSS, Node test runner.

## Global Constraints

- 모든 카드, 버튼, 입력 영역에서 실선 테두리 클래스를 사용하지 않는다.
- 카드와 입력은 `shadow-sm`/`shadow-md`, `bg-white`/`bg-slate-50`로 구분한다.
- 사용자 화면에 `review_required`, `professor_confirmed`, `source.verifiedByProfessor`, `근거`, `High`, `Medium`, `Low`를 노출하지 않는다.
- 수업 유형은 `강의`, `복습` 한글 배지로 표시한다.
- 주차별 편집은 제목과 내용을 해당 카드 안에서 수행한다.
- 로그인·모바일 푸터·기존 공통 레이아웃은 변경하지 않는다.

---

### Task 1: Define the review editor contract and regression tests

**Files:**
- Create: `src/components/professor/weekly-plan-review-editor.test.mjs`
- Create: `src/components/professor/weekly-plan-review-editor.tsx`

**Interfaces:**
- Consumes `WeeklyPlanReview` and `approveWeeklyPlan`.
- Produces an accessible editor with `data-testid="weekly-plan-review-editor"`, edit buttons labeled by week, title/content fields, save/cancel controls, and one final approval button.

- [ ] **Step 1: Write the failing test**

```js
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("weekly plan editor removes internal metadata and exposes inline editing controls", async () => {
  const source = await readFile(new URL("./weekly-plan-review-editor.tsx", import.meta.url), "utf8");
  assert.match(source, /주간 계획 최종 승인/);
  assert.match(source, /aria-label=\{`\$\{week\.weekNumber\}주차 수정`\}/);
  assert.match(source, /onChange=\{\(event\) =>/);
  assert.doesNotMatch(source, /review_required|professor_confirmed|sourceNote|High|Medium|Low/);
  assert.doesNotMatch(source, /border(?:-[a-z]+)?/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/components/professor/weekly-plan-review-editor.test.mjs`

Expected: FAIL because `weekly-plan-review-editor.tsx` does not exist.

- [ ] **Step 3: Implement the minimal editor**

Implement a client component with local `draftWeeks` state, one `editingWeek` id, `startEdit`, `cancelEdit`, and `saveEdit` handlers. Render title and topics/content in view mode; render a shadow-only input and textarea in edit mode. Translate `activityType` with a module-level map. Keep `approveWeeklyPlan` as the only form action and render it once after all course cards.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test src/components/professor/weekly-plan-review-editor.test.mjs`

Expected: PASS.

### Task 2: Replace the server page presentation

**Files:**
- Modify: `src/app/professor/weekly-plan-preview/page.tsx`

**Interfaces:**
- Server page passes `drafts` to `WeeklyPlanReviewEditor`.
- Page retains authentication, data loading, empty, and error states.

- [ ] **Step 1: Write the failing page-structure assertions**

Add assertions to `src/components/professor/weekly-plan-review-editor.test.mjs` for the page source: the internal-state copy and confidence labels are absent, the user-facing approval copy is present, and the page imports `WeeklyPlanReviewEditor`.

- [ ] **Step 2: Run the focused test**

Run: `node --test src/components/professor/weekly-plan-review-editor.test.mjs`

Expected: FAIL until the page is switched to the new editor and copy is replaced.

- [ ] **Step 3: Update the page**

Remove the old `DraftCard`, confidence count grid, source-note paragraphs, status text, warning list, and inline approval forms. Render a concise notice: `교수 승인 전 초안입니다. 내용을 검토 및 수정하신 후 승인하시면 주간 계획(1~15주차)이 확정되어 학생들에게 공개됩니다.` Render an evaluation summary card with `출석 20% | 중간고사 30% | 기말고사 30% | 과제 20%`, then render the new editor.

- [ ] **Step 4: Run focused checks**

Run: `node --test src/components/professor/weekly-plan-review-editor.test.mjs` and `npm run typecheck`.

Expected: both PASS.

### Task 3: Verify responsive behavior and approval interaction

**Files:**
- Modify only if verification exposes a defect in `src/components/professor/weekly-plan-preview/page.tsx` or `src/components/professor/weekly-plan-review-editor.tsx`.

- [ ] **Step 1: Build the app**

Run: `npm run build`

Expected: Next.js compilation, type validation, and page data collection complete successfully.

- [ ] **Step 2: Verify desktop flow in the browser**

Open `http://localhost:3000/professor/weekly-plan-preview`, confirm the page is non-empty and has no framework overlay, click `1주차 수정`, change the title, and confirm `저장` returns the card to view mode with the updated title.

- [ ] **Step 3: Verify mobile flow in the browser**

Use a 390x844 viewport, confirm the cards wrap without horizontal overflow, confirm the edit form remains usable, and confirm the final approval button is visible after scrolling.

- [ ] **Step 4: Verify console health and approval control**

Confirm there are no relevant browser errors/warnings, exactly one `주간 계획 최종 승인` button is rendered, and approved drafts remain non-editable or show the existing approved state without duplicating approval controls.

