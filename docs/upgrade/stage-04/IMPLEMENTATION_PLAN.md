# Stage 4 — Implementation Plan

Status: ACCEPTED (2026-08-12). One commit per task (or per tightly-coupled
task pair). Order: blockers → navigation → timetable/counseling → mobile →
forms/states → consistency/a11y → polish. Every task ends with: relevant unit
suites + typecheck; rendered spot-check where UI-visible; Stage 2 suites where
counseling-adjacent; hydration guard where professor-workspace is touched.

Legend: [RED] = Red→Green with a failing test first (correctness-bearing).

## Phase 1 — Correctness/usability blockers

T1. [RED] Professor action feedback truthfulness (B-1, B-17 surface)
- Problem: runAction ignores result.ok — failures render green and mutate the
  pending queue.
- Files: src/components/professor/professor-workspace.tsx (+ new source test
  src/components/professor/professor-workspace-feedback.test.mjs).
- Test: source-level guard asserting ok-branching + afterSuccess gating.
- Risk: low (client-only). Hydration guard re-run.

T2. [RED] Counseling slot cap per professor (A-2)
- Problem: global slice(0,48) across all professors hides later professors'
  real availability.
- Files: src/lib/counseling-slots.ts (+ test in counseling-slots.test.mjs).
- Test: RED — two professors where prof B's slots all fall beyond the merged
  cap; assert B's slots survive. Full Stage 2 suite after.
- Risk: availability display; primitive untouched.

T3. Timetable delete touch hazard (R-1/C-8/A-21/D-2 item)
- Problem: invisible full-cell delete overlay; center tap = unconfirmed
  destructive removal; hover-only; unlabeled.
- Files: src/components/mypage/my-page-planner.tsx.
- Change: remove inset-0 overlay; corner delete button (visible on
  hover:none media, hover/focus-revealed on pointer-fine), aria-label,
  Radix confirm dialog before removal.
- Verify: rendered — tap center of cell does NOT delete; delete → confirm →
  removed; desktop hover flow preserved.

T4. Counseling month paging + date a11y names (A-3/KI-004 part)
- Files: src/components/counseling/counseling-workspace.tsx.
- Change: viewMonth state bounded to months containing slots; prev/next
  buttons; grid built from viewMonth; aria-label per date button
  ("8월 17일 월요일, 2개 예약 가능").
- Verify: rendered before/after; slot data untouched (same slots prop).

T5. Post-booking freshness + feedback placement (KI-004 part, A-38)
- Files: counseling-workspace.tsx.
- Change: router.refresh() on success; success/error message rendered
  directly under the submit button (role=status); clear selectedSlotId on
  success.
- Verify: rendered booking loop (book → panel updates without navigation) +
  service-role cleanup, per Stage 3 QA method.

T6. Community comments become readable (A-1) [functional-gap fix]
- Files: src/services/student-community.actions.ts (new read-only action
  wrapping existing getPostComments), src/components/community/
  community-board.tsx.
- Change: fetch comments when a post is selected; render list above the
  composer; optimistic count preserved.
- Verify: rendered — write comment, see it listed; typecheck; no new deps.

## Phase 2 — Critical navigation

T7. Mobile nav reachability (C-1, C-2, C-3, A-4 link)
- Files: src/components/layout/app-header-professor-safe.tsx.
- Change: 커뮤니티 + 질문하기(/ask) in mobile menu routes; roadmap drawer
  appends (not replaces) site routes; drawer bottom padding clears the
  bottom nav (pb-24) and z raised.
- Verify: rendered 375px — drawer lists all routes on /dashboard AND
  /roadmap; CTAs tappable.

T8. Drawer dialog semantics (C-4/D-5 subset)
- Files: app-header-professor-safe.tsx, professor-workspace.tsx.
- Change: role="dialog" aria-modal, Escape-to-close, body scroll lock while
  open (shared hook), aria-controls on the burger.
- Verify: rendered — Escape closes; background doesn't scroll.

T9. Assistant shell chrome on /professor (B-18)
- Files: src/components/layout/app-shell.tsx (+ header if needed).
- Change: assistant on /professor* gets professor chrome (bottom nav +
  drawer trigger); other routes unchanged.
- Verify: rendered as 박조교 — mobile nav present on /professor; student/
  admin/professor chrome unchanged.

T10. Roadmap detail reachable (A-5) + back-link label (A-41)
- Files: src/components/roadmap/student-roadmap-workspace.tsx,
  src/app/roadmap/[courseId]/page.tsx.
- Change: offerings link to /roadmap/[courseId]; back link says 로드맵으로
  돌아가기.

## Phase 3 — Timetable/counseling flows

T11. Mobile student timetable scroll (C-7)
- Files: my-page-planner.tsx.
- Change: overflow-x-auto wrapper + min-w on the grid (~560px) below sm.
- Verify: rendered 375px — columns legible, page overflow unchanged (0).

T12. Professor calendar mobile + honesty batch (C-9, C-10, B-12, B-13, B-11
     header, D-2 week-nav labels, D-4 cell keyboard)
- Files: src/components/professor/professor-calendar.tsx.
- Change: overflow-x-auto + minWidth 640 grid; toolbar flex-wrap; legend adds
  상담 불가 with swatches reusing block classes; delete fake sample button;
  dialog header shows clicked chunk's real range; aria-labels on week nav;
  grid cells become buttons with labels.
- Verify: rendered 375px + desktop; hydration guard; no data changes.

T13. Reject flow honesty (B-2, B-3, B-4 toast)
- Files: professor-workspace.tsx.
- Change: datetime-local input, required gating client-side, label drops
  "(선택)"; suggested end derives from matching availability row's
  slot_minutes (fallback 30); remove premature "일정에 추가 했습니다" toast.
- Verify: Stage 2 counseling suites; rendered reject panel behavior.

T14. Course-mode professor picker (KI-004)
- Files: counseling-workspace.tsx.
- Change: when course.professors.length > 1, render professor chips in step
  2 (default professors[0] preserved).
- Verify: rendered — 담보물권법 (2명 담당) shows both; slot lists switch.

T15. Report labels honesty (B-32 label part, B-33 marker)
- Files: professor-course-progress-report.server.ts (include course name in
  the already-read rows if absent), professor-course-progress-report.tsx.
- Change: real course names for 담당 강의 N / 강의 N; students stay
  anonymous "학생 N" (privacy posture unchanged); DEMO marker on the stat
  tiles that can render demo fallbacks.
- Verify: rendered ?tab=report; no scoping change (KI-016 stands).

## Phase 4 — Mobile mechanics

T16. Safe areas + z-order + padding consolidation (C-28, C-30, C-3 z, C-33)
- Files: src/app/layout.tsx (viewportFit), mobile-bottom-nav.tsx,
  professor-mobile-bottom-nav.tsx (padding on outer nav), globals.css
  (delete body ≤900 padding rule; move app-shell-main--with-mobile-nav to
  ≤767px; z tokens for drawer/nav).
- Verify: rendered 375px student+professor+operator — no dead space, no
  covered content.

T17. Dialog mechanics (C-24, C-20)
- Files: src/components/ui/dialog.tsx.
- Change: max-h-[calc(100dvh-2rem)] overflow-y-auto, w-[calc(100%-2rem)]
  mobile gutter, close button p-2 -m-2.
- Verify: rendered register-course dialog with many slot rows at 375px.

T18. Small mobile fixes (C-13, C-26, C-40, C-16)
- Files: register-course-dialog.tsx (sm: prefix), notification-menu.tsx
  (width clamp), globals.css (corrupted selector, scrollbar utility classes
  via existing arbitrary-variant pattern).

T19. Chatbot mobile (A-10/C-39, C-5, C-29)
- Files: ai-tutor-chat.tsx, src/app/chatbot/layout.tsx.
- Change: course selector visible on mobile (compact, above composer);
  bottom nav rendered in chatbot layout with height compensation;
  pb-safe → pb-[env(safe-area-inset-bottom)].
- Verify: rendered 375px — selector visible, send enabled after typing, nav
  present.

## Phase 5 — Forms/states

T20. Route loading states (KI-016 loading backlog)
- Files: new src/app/{dashboard,mypage,counseling,courses,roadmap,community,
  reviews,notifications,professor,admin}/loading.tsx + shared skeleton
  component.
- Change: neutral skeletons (title bar + card blocks), no fake content.
- Verify: build; bundle budgets; rendered nav shows immediate feedback.

T21. Error-vs-empty honesty (KI-003 subset)
- Files: shared components/ui/data-error-notice.tsx; page-level catch sites
  in counseling/page.tsx, mypage/page.tsx, roadmap/page.tsx,
  chatbot/page.tsx, notices/page.tsx.
- Change: catches capture a failure flag; pages render an inline notice with
  새로고침 action instead of silent empty data.
- Verify: rendered (simulate by temporary env break in dev only — or unit
  test the flag plumbing); no behavior change on success path.

T22. Mutation feedback consistency (A-15, A-14, A-13, A-16)
- Files: register-course-button.tsx, favorite-course-button.tsx,
  reviews-board.tsx, ask-professor-form.tsx, weekly-missions.tsx.
- Change: alerts → inline messages; router.refresh() after success; /ask
  toast auto-dismiss + repositioned above bottom nav; weekly-missions
  refresh() instead of reload + error branch.

T23. Onboarding + login form UX (A-8, A-9)
- Files: src/app/onboarding/page.tsx (+ workspace), src/app/login/page.tsx
  (+ small submit component).
- Change: error message map (mirroring login's); useFormStatus pending
  submit buttons (login, onboarding, assistant onboarding).

T24. Mypage feedback + language (A-6, A-7)
- Files: my-page-planner.tsx, student-community.actions.ts.
- Change: hoist feedback banner above the tab sections; translate the 9
  English strings to Korean.

T25. Admin feedback (B-42, B-43 partial, B-45 enum)
- Files: admin-approval.actions.ts ({ok,message} returns), admin/page.tsx
  (small client form wrapper w/ useActionState + pending), status enum
  Korean labels; 반려 requires a confirm step (client).
- Note: no role-model changes (B-44 recorded KI).

T26. Weekly plan editor safety (B-35, B-36)
- Files: weekly-plan-review-editor.tsx.
- Change: cancel restores only that week; unsaved-changes marker; final
  approval gets pending state + inline confirm step.

## Phase 6 — Consistency/accessibility batch

T27. Nested mains + guard (D-1)
- Files: community-board.tsx, reviews-board.tsx, professor-lounge.tsx,
  weekly-plan-preview/page.tsx + new source test asserting no <main> in
  those component files.

T28. Names, focus, disabled (D-2, D-3, D-11, D-16 css part, D-6 subset)
- Files: ai-tutor-chat.tsx (labels, session delete → real sibling button,
  touch-visible, two-step confirm), notification-strip.tsx close label,
  professor-calendar labels (done T12), globals.css (:focus-visible for
  search fields + .button; .button:disabled), counseling professor-search
  aria-label, register-course-dialog + planner + lounge + reviews-filter +
  question-inbox field labels.

T29. Carousel + touch targets (D-14/C-17/C-18, C-19, C-11 — KI-009 closure)
- Files: student-hero-carousel.tsx (pause on hover/focus + pause button +
  reduced-motion; dot hit areas), student-announcement-banner.tsx/feed
  (닫기 p-2.5), today-timetable-widget.tsx + planner links (hit areas).

T30. Notification surfaces (A-29/D-5 item, D-20, A-30 dot)
- Files: notification-strip.tsx (translucent backdrop, dialog role, honest
  copy, sanitized href), notification-menu.tsx (Escape + outside-click
  close, unread dot only when unread, live region on toast).

T31. Status tone + tabs (D-2.6, D-12, cancelled≠rejected style)
- Files: globals.css / message renderers (tone by ok), counseling mode tabs
  role=tab, my-page-section-tabs tablist mapping, professor log cancelled
  branch.

## Phase 7 — Polish (only if all above are green)

T32. Copy/dead-code paper cuts: "1단계 화면 뼈대"/전체 화면 지도 removal
(A-32), /courses empty-catalog copy (A-33), roadmap week-tab honest empty
copy (A-27), delete dead professor-admin-summary.tsx (B-47/KI-015),
impersonation notice banner when rendered professor ≠ session profile
(B-24 UI honesty only).

## Explicitly deferred → KNOWN_ISSUES (KI-017)

B-24 root identity linkage (Stage 6/9); B-5 12-row queue window (Stage 5/8);
B-10 calendar availability-open action; B-20 menu regeneration; B-28 payload
fields; B-31 unscoped roadmap requests (Stage 6/9); B-46 broadcast confirm;
student reservation cancel action (Stage 5); A-12 support auto-reply
escalation; A-18 overdue-todo policy; A-22 JSON slots textarea; A-25/A-26
community composer flow/IA; C-6 professor nav labels; C-15 lounge 621-767
squeeze; C-31 header width; C-34 footer restoration decision; C-37 iOS zoom
font-size sweep; D-7 aria-invalid/describedby sweep; D-17 skip link; D-18
heading hierarchy; breakpoint unification; date-format consolidation; dead
primitive adoption (Badge/Select/Popover); status vocabulary unification.
