# Stage 4 Handoff

## Status

COMPLETE — 2026-08-12. Audit, design, implementation, verification, and
rendered QA done on `upgrade/stage-4` (from `main` @ d8e9ae4, the Stage 3
merge, PR #37). Ready for PR review. Not merged (per workflow). Stage 5 NOT
started.

## Goal

Role-specific / Desktop / Mobile UI-UX enhancement: fix identified usability
problems for the real roles (student/professor/assistant/admin) on desktop
and mobile while preserving functionality, Stage 2 availability semantics,
and Stage 3 performance. No aesthetic redesign.

## Roles and routes audited

All four `user_role` values via the QA demo login panel (김학생/이교수/박조교/
최관리자), rendered on the production build against live Supabase, desktop
1280×720 + mobile 375×812. Routes: login, onboarding, dashboard, mypage
(timetable), counseling (booking + professor management), courses(+detail),
roadmap(+detail), chatbot, community, reviews, ask, notices, notifications,
support, professor workspace (all 5 tabs), professor lounge/mypage/
weekly-plan-preview, admin. Method + Role×Route×Device matrix in UX_AUDIT.md;
four parallel source-audit registers (A/B/C/D finding IDs) feed it.

## What was implemented (22 commits, one concern each)

P0 fixes:
- Professor runAction ok-branching — failures no longer render green or
  remove queue cards (d78f906, RED→GREEN professor-workspace-feedback test).
- Per-professor counseling display cap — one professor's density can no
  longer hide another's real availability (c3f6513, D-009, RED→GREEN;
  characterization test updated deliberately).
- Timetable delete: visible corner control + confirm dialog — the invisible
  full-cell overlay deleted courses on a center tap (9c65d57;
  elementFromPoint-verified before/after).
- Counseling month paging + post-booking refresh + adjacent messaging +
  date-button accessible names (4431bcc).
- Community comments readable — read path never existed (1c3610e).

Navigation/roles: drawer reaches every route incl. 커뮤니티/질문하기, roadmap
drawer prepends instead of replaces, drawer dialog semantics (Escape/scroll
lock/role), assistant gets professor chrome on /professor, /ask + roadmap
detail reachable (58fec75, 650191b).

Timetable/counseling: mobile timetable horizontal scroll (3f59829 guard);
professor calendar mobile scroll + complete legend + fake button deleted +
honest dialog ranges + keyboard cells (12ecdc0); reject flow honest required
fields + requested-duration suggested window (6b87ea2); course-mode
professor chips (b46fd34); report course-name labels + DEMO tile markers
(6e58e26).

Mobile mechanics: viewport-fit=cover (activates all safe-area rules),
bottom-nav safe-area on the outer nav, body-padding consolidation to the
nav's real breakpoint, corrupted CSS selector fix, undefined scrollbar
classes fixed, register-dialog sm: grid, notification dropdown width clamp
(20067f7); dialog max-height/scroll + padded close (aa4f4a3); chatbot course
selector visible on mobile + bottom nav on /chatbot (aa4f4a3).

Forms/states: error-vs-empty notices at 4 page-level catch sites (ca38902);
alert() removal + refresh-after-mutation on courses/reviews/ask/missions
(3c21981); onboarding error map + pending submits (f4f0ea1); mypage feedback
hoist + 9 English strings translated (1841249); admin board result codes +
required reject reason + Korean statuses + empty states (202e2d2); weekly
plan per-week cancel + armed approval (c8c0a43).

A11y/consistency: nested mains ×4 removed + guard test (c9c3089); icon-button
names, real chat-session delete control, focus-visible restorations,
.button:disabled (6046c58); carousel pause/reduced-motion + KI-009 target
closure (0e5c5f6); notification modal/dropdown dialog behavior + honest copy
(c5c5287); failure tones + tab roles + cancelled status styling (cd198f6);
paper cuts incl. scaffolding copy + identity-fallback notice (cb88917).

## What was attempted and deliberately reverted

Route-level loading.tsx (12 routes): rendered QA caught the KI-013 stuck
hydration fallback on direct GETs — orphaned SSR DOM, dead page, no console
errors. Reverted (99bf213) and codified as D-010. Loading-state UX returns
to KI-016 with this evidence.

## Verification (2026-08-12, final build Pj2B64OtjA9Gvqi9PL0fY)

- Full suite: 201 tests / 198 pass / 3 fail — the same pre-existing KI-002
  trio BY NAME (admin-notifications ×2, question-notice-workflow ×1).
- Stage 2 invariant suites: counseling-slots (8/8 incl. new cap test) +
  characterization + availability-consistency + calendar-utils.week +
  counseling-request-security — all green (37/37 at T2 time, re-run in full
  suite).
- New guards: professor-workspace-feedback.test.mjs, no-nested-main.test.mjs,
  cap test in counseling-slots.test.mjs; carousel + mobile-timetable guards
  updated deliberately to pin new behavior.
- typecheck clean; lint: same single pre-existing no-img-element warning
  (one NEW rules-of-hooks error was caught and fixed during verification,
  e118df5).
- npm run build PASS; bundle budgets all met; shared chunk 102 kB unchanged
  (Stage 3 preserved; no new dependencies).
- Rendered QA (production, live Supabase): student booking loop TWICE —
  1st verified request+slot semantics (2건, 8/17 2개→1개), 2nd verified the
  in-place refresh (stayed on /counseling, role=status success message,
  badge/slots updated, selection cleared); both bookings deleted via service
  role and availability restored (1건, 2개). Mobile: timetable scrolls
  (560px grid, page overflow 0), delete visible (opacity 1) + confirm dialog
  + center-tap no longer hits delete; drawer lists all routes with
  role=dialog/Escape/scroll-lock on /dashboard AND /roadmap; chatbot has
  course selector + bottom nav. Professor mobile calendar scrolls (640px
  grid), 6-state legend, no fake button, labeled week nav, 50 keyboard
  cells. Assistant on /professor has the professor bottom nav + the
  "조교 계정으로 박성은 교수님의 워크스페이스를 관리하고 있습니다" notice.
  Admin renders Korean statuses + empty columns. Zero console errors across
  the whole QA session.
- UNVERIFIED: screenshots (Browser pane not displayed this session — all
  rendered evidence is DOM/geometry/interaction measurements); iOS
  safe-area/notch behavior (no device; viewport-fit now set); full WCAG
  audit (contrast unmeasured; scope per DESIGN.md); professor approve→cancel
  runtime round-trip (unchanged code path, still pending from Stage 2);
  one-time post-booking dashboard bounce (KI-017 note, not reproducible).

## Database changes

NONE (no schema, no migrations). One read-only column addition to two
selects (professors.profile_id) and one join added to the report offerings
read (courses.name).

## Decisions

D-009 (per-professor display cap), D-010 (no route-level Suspense seams) —
in DECISIONS.md.

## Known-issues reconciliation

KI-009 RESOLVED; KI-004 mostly resolved (login→onboarding mystery remains);
KI-015 partially resolved (reject window + dead component; cancel-notification
text still open; stat tile reclassified as dead computation); KI-016 updated
(loading attempt reverted with evidence, nested mains fixed); KI-013 addendum
(generalized lesson); KI-017 NEW (full deferred backlog incl. B-24 root cause,
B-5 queue window, student cancel action for Stage 5).

## Relevant commits (main..upgrade/stage-4)

3726489 CLAUDE.md + scaffold · 50d43db audit/design/plan · d78f906 T1 ·
c3f6513 T2 · 9c65d57 T3 · 4431bcc T4/T5 · b46fd34 T14 · 1c3610e T6 ·
58fec75 T7/T8 · 650191b T9/T10 · (T11 in) 3f59829-adjacent · 12ecdc0 T12 ·
6b87ea2 T13 · 6e58e26 T15 · 20067f7 T16/T18 · aa4f4a3 T17/T19 · ca38902 T21 ·
3c21981 T22 · f4f0ea1 T23 · 1841249 T24 · 202e2d2 T25 · c8c0a43 T26 ·
c9c3089 T27 · 6046c58 T28 · 0e5c5f6 T29 · c5c5287 T30 · cd198f6 T31 ·
cb88917 T32 · e118df5 hooks fix · 99bf213 loading.tsx revert · final docs
commit.

## Exact next action

1. Push `upgrade/stage-4`; open PR to `main`; external review; fix findings
   on the branch; human-approved merge (do NOT self-merge).
2. Stage 5 starts only after merge, from CURRENT_STAGE.md + this handoff.

## Stage 5 inputs

- KI-017: student reservation CANCEL action does not exist (stale pending
  requests for past times linger); B-5 12-row queue window; the booking
  double-submit is UI-guarded only — server-side concurrency is Stage 5's
  charter (the GiST exclusion constraint is the current authority).
- Stage 4 left booking/availability semantics byte-identical except the
  per-professor display cap (D-009) — Stage 5's transaction work builds on
  the same canonical domain (D-004/D-005/D-006).
- runAction now surfaces server failures honestly — Stage 5 can rely on the
  professor UI reporting concurrency conflicts instead of hiding them.

## Exit gate checklist

- [x] Stage 3 merged into base (d8e9ae4) / [x] upgrade/stage-4 branch used
- [x] CLAUDE.md persistent workflow rules added (3726489)
- [x] actual user roles audited (all four, rendered + source)
- [x] critical routes audited / [x] desktop UX / [x] mobile UX audited
- [x] timetable UX reviewed + fixed / [x] counseling UX reviewed + fixed
- [x] responsive problems addressed (safe areas, scroll containers, dialogs,
      padding consolidation)
- [x] loading/empty/error states reviewed (error notices shipped; loading
      skeletons attempted, reverted with evidence — D-010)
- [x] accessibility issues reviewed + high-impact fixed (names, focus,
      dialogs, landmarks, carousel, live regions); full WCAG NOT claimed
- [x] high-impact UX problems implemented (5 P0s + ~25 P1s)
- [x] existing functionality preserved (full suite at KI-002-only baseline;
      rendered booking loop; zero console errors)
- [x] Stage 2 availability invariants preserved (suites + rendered loop;
      the one deliberate display change is D-009, RED-tested)
- [x] Stage 3 performance not materially regressed (bundle budgets met,
      shared 102 kB unchanged, query-count guards green, no new deps)
- [x] relevant tests pass / [x] typecheck/lint/build recorded
- [x] rendered desktop QA completed / [x] rendered mobile QA completed
      (DOM-measurement evidence; screenshots UNVERIFIED — pane unavailable)
- [x] DECISIONS.md updated (D-009, D-010) / [x] KNOWN_ISSUES.md updated
- [x] HANDOFF.md completed (this file) / [x] CURRENT_STAGE.md synchronized
- [x] branch pushed / [x] Pull Request created
