# Stage 4 — UX Design

Status: ACCEPTED (2026-08-12). Derived from UX_AUDIT.md; every change below
answers an identified usability problem. No aesthetic redesign.

## Roles discovered

`student | professor | assistant | admin` (user_role enum; Stage 1 matrix).
- **student** — highest-frequency user; mobile-first reality (bottom nav);
  primary jobs: today's plan (dashboard), timetable management (mypage),
  counseling booking, course browsing, AI chat.
- **professor** — desktop-leaning; jobs: weekly calendar/availability,
  counseling request triage, questions, weekly plans, reports. Has dedicated
  mobile bottom nav.
- **assistant** — shares /professor (subset) + /admin approvals; currently
  shell-orphaned on mobile.
- **admin** — /admin: roadmap approval board + broadcast console. Low
  frequency, desktop.

## Critical journeys

1. Student books counseling (counseling search → date → slot → submit →
   confirmation → sees request status). Correctness-critical (Stage 2).
2. Student manages timetable on a phone (view week, add course, remove
   course).
3. Professor triages counseling requests (see pending → approve/reject with
   suggestion → student notified). Correctness-critical feedback.
4. Professor manages weekly availability (calendar).
5. Student consumes async states everywhere (loading/empty/error).

## Current UX problems

See UX_AUDIT.md §2 matrix. Summary of what Stage 4 fixes: 5 P0s (invisible
touch-delete hazard, professor success-on-failure feedback, 48-slot
cross-professor display cap, unreachable month slots, write-only comments),
~25 P1s (mobile nav gaps, drawer/dialog mechanics, stale-after-mutation
feedback, error-vs-empty conflation, zero loading states, touch targets,
a11y names/focus), plus low-risk P2/P3 paper cuts.

## Desktop strategy

Preserve layout and improve hierarchy/feedback (Option A of the evaluated
approaches — see "Options considered"). No structural desktop changes: fix
feedback truthfulness (professor runAction, admin void actions, failure
colors), dialog mechanics, focus visibility, and label honesty (fake button,
mislabeled menu items, report row labels).

## Mobile strategy

Mobile is NOT re-architected; the existing patterns (bottom nav + hamburger
drawer + single-column collapses) are kept and completed:
- Close the reachability holes (커뮤니티 in drawer; roadmap drawer appends
  instead of replaces; /ask reachable; assistant gets professor chrome on
  /professor).
- Make the two dense grids (student timetable, professor calendar) scroll
  horizontally with a sane min-width instead of compressing 7–5 columns into
  31–42px.
- Make destructive/primary controls touch-real: visible delete affordance on
  timetable cells + confirmation; chatbot course selector visible; 44px-class
  hit areas on the KI-009 list; dialog close targets.
- Activate safe-areas (viewport-fit=cover) and fix the z-order inversions.

## Responsive strategy

Use existing breakpoints only (Tailwind defaults + the 620/700/900 CSS
blocks). No new breakpoint values. Overflow fixes use per-surface
`overflow-x-auto` wrappers (html/body keep `clip`). The Tailwind-vs-CSS
schism is documented but NOT unified this stage (too broad; KI-017).

## Accessibility improvements

Scope: high-impact, evidence-backed basics (not a WCAG certification):
aria-labels on unnamed icon buttons and unlabeled fields on core flows;
nested-main removal (4 sites) + regression guard; focus-visible restoration
(search fields, chat inputs, shared .button) and .button:disabled styling;
dialog/drawer semantics (role, aria-modal, Escape, scroll lock) on the
hand-rolled overlays; live regions on the professor toast and form results;
carousel pause + prefers-reduced-motion; correct accessible names on
counseling date buttons; tab roles on counseling mode switch. Unverified
areas (contrast, full SR pass) stay labeled UNVERIFIED.

## Component consistency strategy

Minimal-risk consolidation only where Stage 4 already touches the surface:
- Dialog mechanics fixed once in ui/dialog.tsx (max-height, close target).
- Counseling status: cancelled no longer renders in the rejected/red branch;
  admin board translates raw enum values. Full vocabulary unification → KI.
- No design-system refactor, no adoption drive for dead primitives (recorded
  as KI-017 candidates), no date-formatting consolidation this stage.

## Timetable UX

- Mobile: horizontal scroll container with min-width so day columns stay
  legible; weekend columns retained (existing mental model).
- Delete: remove the invisible full-cell overlay. A small, labeled, visible
  (on touch; hover/focus-revealed on desktop) delete button + confirm dialog
  (existing Radix primitive). Grid semantics, colors, layout unchanged.
- Dashboard widget link hit-area enlarged. No data or slot-semantics changes.

## Counseling UX

Student:
- Slot cap applied per professor (RED test first) so displayed availability
  matches the canonical per-professor bookable set. `buildBookableSlotsForLocalDate`
  (the correctness primitive) is untouched; only the presentation-list cap in
  `buildAvailableCounselingSlots` moves. Stage 2 suites must stay green.
- Month navigation derived from the actual slot range (KI-004).
- Post-booking: router.refresh(), success message adjacent to the action,
  selection cleared. Booking eligibility/action payload unchanged.
- Course mode: professor picker rendered when a course has >1 professor
  (uses already-fetched courseProfessors; auto-select behavior preserved as
  default).
Professor:
- runAction branches on ok; failures render as errors and do NOT mutate the
  queue. Approve/reject payloads unchanged.
- Reject form: honest labels, datetime-local input, client-side required
  gating; suggested end uses the availability row's slot_minutes when
  available (KI-015 fix) — falls back to 30.
- Calendar: mobile scroll container; legend completed (상담 불가) with
  swatches matching block styles; fake sample button deleted; week-nav
  buttons labeled; dialog header shows the actual clicked chunk range.

## Changes explicitly NOT being made

- No booking/availability semantic changes: `buildBookableSlotsForLocalDate`,
  busy-status rules (D-005), KST normalization (D-006) untouched.
- No auth/authz/RLS changes (KI-011/KI-014 stay Stage 9).
- No professor identity-linkage fix (B-24 root cause → KI-017/Stage 6/9; the
  demo fallback stays; we do not add cross-professor pickers).
- No reservation concurrency/double-booking work (Stage 5). UI double-submit
  guards only.
- No counseling queue query changes (B-5 12-row window → KI-017/Stage 5/8).
- No report scoping change (KI-016 stands; we only label rows with real
  course names — student rows stay anonymous "학생 N" deliberately).
- No new dependencies, no design system, no icon set changes, no theming.
- No breakpoint-system unification, no date-format consolidation, no broad
  Button/Select/Badge adoption sweep (KI-017).
- No student-side reservation cancel action (new API semantics → Stage 5
  input; recorded).
- No navigation paradigm changes (bottom-nav tab set unchanged; drawer
  retained).

## Regression risks

1. **counseling-slots.ts cap change** — risk to Stage 2 identity invariant.
   Mitigation: RED test for the cross-professor hiding; full Stage 2 suite
   (counseling-slots, availability-consistency, characterization,
   calendar-utils.week, counseling-request-security) after; cap semantics
   only affect list length, never slot membership per professor.
2. **router.refresh() additions** — could re-trigger request-scoped reads.
   Request-scoped memoization (D-007) makes this a fresh render, identical to
   navigation; no cross-request cache exists. Query-count guard tests still
   pin topology.
3. **app-shell/isProfessor chrome change for assistants** — could leak
   professor chrome to students/admins. Mitigation: condition scoped to
   role==='assistant' && pathname.startsWith('/professor'); rendered QA all
   four roles.
4. **globals.css bottom-padding consolidation** — risk of content hidden
   under bottom nav on some routes. Mitigation: rendered checks at 375px on
   student + professor + operator routes.
5. **loading.tsx introduction** — changes perceived navigation (streamed
   shell). No data semantics; bundle budgets re-checked; skeletons are
   neutral (no fake content).
6. **professor-workspace edits** — the file is guarded by
   professor-page-hydration.test.mjs (KI-013). No dynamic() reintroduction;
   test re-run after every edit.
7. **Community comments read path** — additive read-only server action; runs
   only on post selection. No write-path changes. Query is bounded (one post
   id). Flagged as the one functional-gap fix in scope (write-only Q&A is a
   confirmed usability bug, not a redesign).

## Options considered for the structural questions

Timetable on mobile: (a) horizontal-scroll grid (chosen — preserves the
week-grid mental model, smallest change), (b) day-list/agenda transform
(rejected: new presentation to maintain, duplicates information architecture),
(c) pinch-zoom/scaling (rejected: poor a11y, fights the browser).

Professor calendar on mobile: same trio; (a) chosen for the same reasons;
agenda view noted as a future option in KI-017.

Mobile community access: (a) add to drawer (chosen — zero paradigm change),
(b) 5th bottom-nav tab (rejected: crowds the 4-tab bar, evidence doesn't
show community is top-4 frequency), (c) merge into mypage tabs (rejected:
hides it deeper).

Error-vs-empty (KI-003): (a) page-level inline error notice + retry via
refresh (chosen — smallest honest fix at the existing .catch sites), (b)
throw to error.tsx everywhere (rejected: loses the whole page for partial
failures), (c) per-widget error boundaries (rejected: broad refactor).
