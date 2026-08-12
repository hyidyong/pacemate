# Stage 3 Handoff

## Status

COMPLETE — 2026-08-12. Implementation, tests, validation, and rendered QA done
on `upgrade/stage-3` (from `main` @ cfa540f, the Stage 2 merge). Ready for PR
review. Not merged (per workflow). Stage 4 NOT started.

## Goal

Improve measured user-perceived loading/interaction performance while
preserving Stage 1 behavior and Stage 2 availability correctness.

## Baseline used

- Stage 1 dev-mode baseline (stage-01/PERFORMANCE_BASELINE.md) reproduced
  under comparable conditions (dev, warm loads): dashboard had REGRESSED to
  875–1014 ms TTFB since Stage 1 via the post-Stage-1 card-service chains.
- New Stage 3 canonical baseline: production build, warm loads, live Supabase
  (PERFORMANCE_AUDIT.md §2). Live demo-DB row counts recorded (§5.0) — at this
  scale latency is round-trip-count-bound, not row-volume-bound.

## Bottlenecks found (ranked in PERFORMANCE_AUDIT.md §9)

1. KI-013: /professor stuck in lazy fallback 4/4 direct GETs (page unusable).
2. AppShell tail duplicate profile+notifications on ~20 prop-less routes.
3. /dashboard identity re-derivation (~26 queries, 3× auth.getUser, ~11 stages).
4. /mypage 4× getPosts triple (12 queries where 3 suffice) + dead
   student_profiles select("*").
5. False sequential batches (counseling, courses, aggregate plans/progress).
6. recharts eager on /professor (339 kB First Load) for a non-default tab.
7. (revised — see Decisions) professor counseling-query "duplicate" was NOT
   derivable: different status filters; both queries kept.

## Optimizations implemented (one commit each)

- b4bfe9f KI-013 fix: static import of ProfessorWorkspace (the dynamic()
  wrapper deferred nothing — chunk eager in manifest); nested <main> → div;
  redundant inline action import removed. 8/8 direct GETs render after.
- 1a11350 React.cache() on getDemoProfile + notification getters (AppShell
  dedupe on ~20 routes). No cross-request caching anywhere (D-007).
- 7d0f4a1 /mypage posts feed fetched once, 4 views derived; 7 independent
  reads in one Promise.all; dead student_profiles fetch removed.
- 176876e counseling page: one 7-query batch (student_courses →
  course_professors stays sequential inside its branch); /courses favorites
  parallelized with course list.
- 65c802a shared request-scoped identity resolver
  (src/services/request-identity.server.ts) consumed by the 3 dashboard card
  services; dashboard notification pair moved off the critical path.
- a28b73c professor page: report/aggregate/inbox identity chains on the shared
  resolver (3→1 auth round trips); aggregate plans+progress in one batch.
- fca8ddc recharts report view lazy (ssr:false) INSIDE the client workspace:
  /professor First Load 338→225 kB gz.
- 0a63941 scripts/check-bundle-budgets.mjs (deterministic bundle gate).

## Before/after measurements

PERFORMANCE_AUDIT.md §11 (full table). Headlines: /professor usable 0/4→8/8;
/professor First Load −33%; mypage 12→3 posts queries (test-pinned);
counseling 5→7 queries issued before first WAN resolution (test-pinned);
auth.getUser 3→1 on dashboard and professor (test-pinned); client-nav
mypage→counseling 852→268 ms; TTFB /mypage 315 ms (was 412–528), /courses 228
(was 284); /dashboard and /professor TTFB within live-DB variance —
deterministic wins recorded, wall-clock improvement UNVERIFIED there.

## Database changes

NONE (no schema, no indexes, no migrations — D-008 context; candidates
documented in KI-016 for Stage 8).

## Network/client/bundle/cache changes

Fewer round trips per §above; no fetch added anywhere. Client changes limited
to the professor workspace (tag swap + lazy report view). Bundle: recharts out
of first load; shared 102 kB unchanged. Cache: request-scoped React.cache
ONLY; TTL = one render; nothing survives a response; booking/cancel freshness
unchanged (D-007 questionnaire answered in DESIGN.md §5.1).

## Correctness verification (2026-08-12, all on the final build)

- Full suite: 192 tests / 189 pass / 3 fail — the same pre-existing KI-002
  trio BY NAME (admin-notifications ×2, question-notice-workflow ×1).
- Stage 2 invariant set (counseling-slots + characterization +
  calendar-utils.week + availability-consistency + counseling-request-security)
  36/36; offering-ownership-gate 2/2; session-performance 2/2.
- typecheck clean; lint: same 1 pre-existing warning (no-img-element).
- npm run build PASS; bundle guard: all budgets met (BUILD_ID lJmULIxi…).
- Rendered QA (production, live DB): student booking loop — booked 박성은
  8/17 09:30 (74f5b283), 2개→1개 + slot removed + pending panel at correct
  KST; service-role cleanup (204) → 2개 restored. Same counts desktop/mobile
  375px, no overflow, no console errors. Professor: workspace renders 8/8
  direct GETs incl. mobile; ?tab=report renders 5 recharts nodes with real
  data through the rewired services; three-state calendar legend intact.

## New regression protection

- professor-page-hydration.test.mjs (KI-013 seam guard)
- request-memoization.test.mjs, request-identity.test.mjs (cache wiring)
- student-community.query-count.test.mjs (posts feed ×1, view semantics)
- counseling.query-count.test.mjs (batch topology + query inventory)
- scripts/check-bundle-budgets.mjs (run after fresh build)

## Remaining bottlenecks / known risks

KI-016 (new, documented): unscoped professor reports (also privacy — Stage
6/9); unbounded queries + index candidates (Stage 8); no loading states
(Stage 4); supabase-js in shared shell (Stage 4/8); rerender hotspots +
other nested-main files (Stage 4); dashboard student_courses 5× different
reads (Stage 4/8). KI-002/KI-003/KI-004/KI-005/KI-011/KI-014/KI-015 unchanged.
Risk: React.cache wiring is frozen by source tests; a refactor to plain
functions silently reintroduces duplicates if those tests are deleted.

## Decisions

D-007 (request-scoped memoization only), D-008 (deterministic perf guards) —
in DECISIONS.md. Audit self-correction recorded: rank-7's "management list ⊂
calendar superset" was wrong (status filters differ); both queries kept.

## Relevant commits (main..upgrade/stage-3)

e4d18e9 scaffold · 1cd7fed audit/design/plan · b4bfe9f KI-013 ·
1a11350 cache() session/notifications · 7d0f4a1 mypage posts ·
176876e counseling/courses batches · 65c802a dashboard identity ·
a28b73c professor identity+batch · fca8ddc recharts lazy · 0a63941 bundle
guard (+ final docs commit).

## Exact next action

1. Push `upgrade/stage-3`; open PR to `main`; external/Codex review; fix
   findings on the branch; human-approved merge (do NOT self-merge).
2. Stage 4 starts only after merge, from CURRENT_STAGE.md + this handoff.

## Stage 4 inputs

- KI-016 list above (loading states, shell weight, rerender hotspots, nested
  mains) is the Stage 4 performance-adjacent UX backlog.
- Post-Stage-3 TTFB ranges in PERFORMANCE_AUDIT.md §11 are the "before" for
  any Stage 4 skeleton/streaming work.
- KI-009 touch targets, KI-004 UX edges, KI-015 paper cuts remain open.

## Exit gate checklist

- [x] Stage 2 verified merged into base (cfa540f == main == branch base)
- [x] upgrade/stage-3 branch created
- [x] Stage 1 performance baseline reviewed (+ dev-mode reproduction)
- [x] Stage 2 availability invariants reviewed (SPEC; suites in every task)
- [x] critical user journeys profiled (AUDIT §3; desktop + mobile)
- [x] current baseline measured (AUDIT §2, prod + dev)
- [x] network waterfall audited (§3) / duplicate requests audited (§3, §9)
- [x] server/API critical path audited (§4)
- [x] database queries audited (§5; live row counts)
- [x] client rendering/hydration audited (§6)
- [x] bundle/delivery audited (§7)
- [x] bottlenecks ranked (§9) / budgets defined (§10)
- [x] design documented (DESIGN.md) / implementation plan (IMPLEMENTATION_PLAN.md)
- [x] high-impact justified optimizations implemented (8 commits)
- [x] before/after measurements recorded (§11)
- [x] Stage 2 availability correctness preserved (36/36 + identity suite +
      rendered booking loop)
- [x] booking/cancellation refresh correctness preserved (rendered loop above)
- [x] relevant regression tests pass (192/189/3 — same KI-002 trio by name)
- [x] typecheck/lint/build results recorded
- [x] desktop performance checked / [x] mobile performance checked (375px)
- [x] no unintended UI/UX redesign (deltas: KI-013 bug fix; report tab shows a
      one-time loading line on first open — documented, §22-compliant)
- [x] DECISIONS.md updated (D-007, D-008)
- [x] KNOWN_ISSUES.md updated (KI-013 RESOLVED; KI-016 added)
- [x] HANDOFF.md completed (this file) / CURRENT_STAGE.md synchronized
- [x] branch ready for PR
- UNVERIFIED: FCP/LCP/INP/CLS (no tooling exposed paint entries — same gap as
  Stage 1); wall-clock TTFB improvement on /dashboard and /professor
  (within live-DB variance; deterministic round-trip reductions are the
  verified record); professor approve→cancel runtime round-trip (unchanged
  code path, still pending from Stage 2 — KI-013's fix now makes that QA
  practical for the reviewer).
