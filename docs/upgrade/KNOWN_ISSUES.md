# Known Issues

Issues must be added only when reproduced or supported by repository/runtime evidence.
Historical reports may be investigated but are not automatically considered currently reproducible bugs.

## KI-021 — Stage 8 scale/reliability: findings deferred by design

Status: OPEN (documented 2026-08-13; full evidence in docs/upgrade/stage-08/).
Stage 8 closed two P0 correctness/security defects and four P1 scale items
(D-022/D-023). The following are recorded with evidence rather than silently
carried:

- **Rate limiting is NOT implemented** (SCALE_AUDIT P1-4,
  IMPLEMENTATION_PLAN §8). No app-level limiter exists anywhere. Deferred
  deliberately: the concrete abuse vectors found were authorization holes (now
  closed), no tier showed a request-rate bottleneck (0% errors throughout), an
  in-memory limiter on Vercel serverless is per-instance and resets on cold
  start (protection theatre), and per-IP scoping is actively wrong behind
  campus NAT. Doing it properly needs a production traffic baseline plus the
  KI-018 M10 product decision (how many pending requests one student may hold).
  `/support` additionally requires NO session at all
  (support.actions.ts:27,47) — fix the authorization before adding a limiter.
- **Unbounded professor report reads remain** (KI-016 carry-over):
  professor-anonymous-weekly-aggregate.server.ts:266 and
  professor-course-progress-report.server.ts:199 fetch ALL `course_offerings`
  platform-wide, then all matching progress rows. Stage 8 added the
  `student_weekly_progress (offering_id, week_number)` index that makes the
  second query survivable, but the SCOPING fix changes displayed content and is
  entangled with the Stage 9 privacy work, so it stays there.
- **No pagination anywhere**: `.range()` appears zero times in the codebase.
  The `limit 80` / `limit 40` feed caps are silent truncation, which becomes a
  correctness problem (users cannot reach their own older posts) before a
  performance one.
- **Admin broadcast does not chunk**: admin-notifications.actions.ts:66-73,92
  builds an `IN` list of every tenant profile and inserts one row per recipient
  in a single statement. Fine at demo scale; needs chunking before a
  full-size tenant exists.
- **Escalations inbox is unbounded** and, on the assistant/admin branch, has no
  filter at all (professor-questions.server.ts:125-131). Stage 8 added the
  `(professor_id, created_at desc)` index for the professor branch only.
- **Notification READ path is still untenanted**
  (notifications.service.ts:63-69,90-93) — the same `OR` shape whose WRITE side
  Stage 8 fixed. Left to Stage 9 with KI-019, because read isolation is not
  DB-enforceable until the anon SELECT policy family is overhauled. The KI-016
  "user_notifications partial unread index" candidate is consequently REFINED,
  not adopted: one partial index cannot serve an `OR` across two columns, and
  the `school_id`-leading variant only becomes usable once that tenant filter
  exists.
- **`user_notifications.school_id` remains nullable** (D-018), so the Stage 8
  tenant-scoped bulk mark-read deliberately does not match untenanted rows.
  Live check at fix time: 0 such rows exist. If ungated writers later create
  them, those notifications become undismissable in bulk until D-018's NOT NULL
  work lands.
- **The middleware auth cost is UNVERIFIED**: `getClaims()` verifies locally
  when JWTs are asymmetric (JWKS cached ~10 min per warm instance) but falls
  back to a GoTrue network call per request when they are symmetric (HS256).
  Which applies here is a Supabase dashboard setting not visible in the repo.
  Decode a live access token's header (`alg`/`kid`) before designing any
  auth-cost mitigation — the answer changes the plan by an order of magnitude.
- **PostgREST `!inner` embed filters may not use the tenant filter to drive the
  scan** (three availability reads, counseling.service.ts:125-130, 254-257,
  278-281). Analysis only, needs `EXPLAIN` against the live DB to confirm; if
  confirmed, resolve tenant professor ids first and use `.in("professor_id",…)`.
- **Load tiers above 10 concurrent VUs / 20 concurrent bookings were NOT RUN**
  (high, stress, breaking point, recovery). They are implemented in the harness
  and blocked only on the absence of a non-production Supabase project. Nothing
  about capacity beyond the tested numbers is claimed.
- **Legacy `console.*` sites remain** (~70 across 28 files) alongside the new
  structured logger, and ~40 bare `catch {}` still swallow failures (KI-003
  family). Stage 8 converted the highest-value sites only.

## KI-020 — Stage 7 SSO readiness: residuals, blocked externals, and findings recorded in passing

Status: OPEN (documented 2026-08-13; evidence in docs/upgrade/stage-07/*).
Stage 7 shipped the SSO-ready boundary (D-019..D-021) with real-university
integration BLOCKED. Remaining, honestly scoped:

- BLOCKED external integration: connecting any real university IdP requires
  institution-supplied OIDC issuer/client/secret or SAML metadata/cert/ACS,
  claim mappings, test accounts, JIT rule sign-off, a per-university admin,
  and (for SAML) the Supabase Pro plan. Never fabricate these
  (PROVIDER_CONTRACT.md §4). The live GoTrue↔IdP exchange is therefore
  UNVERIFIED end-to-end; the app boundary around it is fully tested.
- Plaintext demo credentials ship in the client bundle:
  `src/config/demo-users.json` (4 accounts with passwords) is imported by the
  client component `src/components/login/demo-login-button.tsx`. Must be
  removed or build-gated BEFORE any real IdP connects (found by the Stage 7
  discovery audit; pre-existing).
- In-session revocation limits (pre-existing, unchanged): the HMAC app
  session is irrevocable until its 8h expiry (no server-side store), and
  request-time suspension enforcement for existing sessions needs the
  profile queries (session.service.ts:51,64) to join schools.status — the
  fail-closed seam exists in resolveTenantContext (D-021); wiring it is
  Stage 9's session/RLS overhaul territory. No SLO / provider logout is
  claimed (Supabase SAML has none).
- Identifier namespace decision pending: `profiles.identifier` stays
  GLOBALLY unique and doubles as the auth email; a cross-tenant handle
  collision denies SSO logins (tested) instead of merging. Moving to
  `unique(school_id, identifier)` + tenant-qualified login is the documented
  breaking point (stage-06 HANDOFF, SSO_DESIGN §13).
- `policy.enforceSsoOnly` is modeled and parsed but no UI/flow consumes it
  yet (password login remains available to all roles during transition).
- Professor read-path first-row fallback (KI-017 B-24,
  professor.service.ts:189-196) is unchanged and remains a MUST-FIX before a
  second live tenant exists — an SSO professor without a professors row gets
  empty pages (read) / fail-closed denial (write).
- Latent, UNVERIFIED (discovery agent finding): `saveAssistantOnboarding`
  (onboarding.actions.ts:224-228) derives identity via a student-only
  `getProfileId`, which appears to bounce a logged-in assistant to /login
  although the assistant login gate depends on the cookie this action sets.
  Verify and fix in the stage that owns onboarding.
- Single-tenant fossil: `ensureDefaultSchoolAndDepartment`
  (onboarding.actions.ts:189-222) still assigns the school hardcoded by name
  계명대학교 during student onboarding — harmless with one tenant, wrong the
  moment a second exists; SSO JIT/linking (which sets tenant from the
  provider) is the replacement path, but the legacy onboarding write must be
  retired before tenant #2.

## KI-019 — Stage 6 multi-tenancy: residual cross-tenant surfaces deferred by design

Status: OPEN (documented 2026-08-12; full evidence in
docs/upgrade/stage-06/TENANT_DATA_AUDIT.md §7.5/§8 and DESIGN.md). Stage 6
enforced tenant isolation at the trusted server boundary for the counseling
domain (booking, professor directory, status/details writes), the admin
broadcast, community post writes/reads, and the assistant-answer RPC, plus a
live-verified DB backstop on the counseling INSERT. The following remain and
are NOT falsely asserted closed:

- Anon direct-PostgREST access (AUDIT §7.5, A1/A2): the public publishable key
  + demo `using(true)`-class anon policies still expose profiles,
  student_profiles, student_courses, counseling_requests (SELECT),
  user_notifications (SELECT/INSERT/UPDATE), student_mission_progress, and the
  catalog to a crafted `curl`, independent of all app-layer scoping. This is
  the KI-007/011/014 family — the Stage 9 RLS overhaul. Stage 6 deliberately
  did not patch one policy into that known-wrong family twice (D-014/D-016
  discipline).
- Notification tenancy (D-018): `user_notifications.school_id` is nullable and
  stamped best-effort; ungated writers (support, roadmap-feedback,
  admin-approval, professor-questions broadcasts) may leave it NULL, and the
  notification READ path is not yet tenant-scoped (the anon SELECT policy means
  read isolation is not DB-enforceable until Stage 9). The concrete admin
  broadcast recipient leak IS fixed.
- Realtime notification channel (AUDIT §7.4): the `recipient_id` filter is
  client-side over the anon SELECT policy; a crafted subscribe frame streams
  other users' notifications. Full fix is the Stage 9 notification RLS.
- Unscoped catalog/reviews reads (X7/X10, KI-016): course catalog
  (course.service getCourseById / getCourseSummaries, student-community
  getCourses) and course_reviews reads are not tenant-scoped. Lower-risk
  (public reference content, 0 live reviews) and entangled with the anon-read
  family; the community BOARD (getPosts) and post WRITES are scoped.
- Professor report services (KI-016): read all offerings/progress, RLS-only,
  no app tenant filter — Stage 9 defense-in-depth.
- getRoadmapRequests / roadmap-revision reads (KI-017 B-31): unscoped;
  roadmap_revision_requests targets are denormalized strings with no tenant
  column (0 live rows).
- Client state (AUDIT §7.2, X13): unkeyed localStorage
  (pacemate_student_todos / _done / dismissed-course-notices) and the Zustand
  chat store are not reset on logout → cross-account bleed on shared devices.
  Not strictly a tenant-isolation gap (the app has no in-session tenant
  switching, spec §19); a shared-device privacy follow-up.
- Storage bucket `syllabus-files` policies are bucket-wide for all
  authenticated users (AUDIT A3); storage path tenant-prefixing is Stage 7/8.
- academic_terms NULL-school "global term" and course_equivalencies zero-UUID
  bucket are accidental cross-tenant namespaces (0 affected live rows);
  cleanup deferred to Stage 8.
- professors(school_id, email) uniqueness not added (emails not guaranteed
  present); documented.
- schools.status is enforced in resolveTenantContext's contract but there is
  no suspension flow in Stage 6; a suspended-tenant denial is a one-line
  addition when Stage 7 builds suspension.

## KI-018 — Stage 5 concurrency findings deferred by design

Status: OPEN (documented 2026-08-12; evidence in docs/upgrade/stage-05/DESIGN.md §13
and CONCURRENCY_TEST_MATRIX.md). Deferred deliberately:
- M10: nothing bounds one student's pending requests across DIFFERENT slots (no
  constraint includes student_id). Product-policy question, not a race defect.
- R6 write side: professor-suggested times (reject flow) are validated against
  nothing at write time (professor.actions.ts requires only non-empty
  suggestedStart); an off-grid/unavailable suggestion renders a button that can
  only fail with SLOT_NOT_AVAILABLE. Consumption-side protection (Stage 5)
  already prevents any invalid booking; the write-side rule needs a product
  definition. Stage 6/8 candidate.
- Notification best-effort gap: the reservation write and its notification are
  two round trips by design (D-011 rejected the RPC fusion); a crash in between
  loses the notification silently (the handled failure path is honest —
  ok:true degraded message, characterization-pinned). Outbox/reliable delivery
  belongs to Stage 8.
- professor_note/suggested_* are still nulled unconditionally by approve/cancel
  transitions and raced by updateCounselingDetails (last write wins on the
  note). The CAS from-state guard (D-012) serializes STATUS, not these columns.
  Fold into the Stage 8/9 counseling hardening.
- Ops note: /counseling (student page) now requires SUPABASE_SERVICE_ROLE_KEY
  at runtime for the busy feed (D-011) — same requirement professor pages
  already had; deployments missing the key render the Stage 4 error notice.

## KI-017 — Stage 4 audit findings deferred by design

Status: OPEN (documented 2026-08-12; full evidence in docs/upgrade/stage-04/UX_AUDIT.md
and the four audit agent registers referenced there). Deferred deliberately per
stage-04/DESIGN.md "Changes explicitly NOT being made":
- B-24 root cause: professor identity fallback (`getCurrentProfessor` falls back to
  the first professors row; assistants always resolve their linked/first professor).
  Stage 4 added an honest UI notice only. Real fix = identity linkage, Stage 6/9.
  Note: the demo student's pending request (to 박성은) is reachable only via the
  assistant login — no professor demo account maps to 박성은.
- B-5: professor pending queue + log share one 12-row oldest-first window
  (professor.service.ts getCounselingRequests limit(12) across all statuses); new
  pending requests can be invisible; notification deep links can target absent rows.
  Stage 5 (reservation flow redesign) / Stage 8.
- B-6: professor home entry points driven by unread notification counts, not
  outstanding work — they disappear on first visit while work remains.
- B-10: no way to DECLARE availability from the calendar (only blackout); the
  manual-schedule form has no date context and no row edit/delete (B-25/B-26).
- B-20: professor desktop dropdown has 15 items resolving to 8 destinations, some
  mislabeled (e.g. 과제 및 평가 → 담당 과목 삭제 요청 screen).
- B-28: roadmap edit pre-fills placeholder prose that can be published verbatim;
  two typed fields are never transmitted.
- B-31: getRoadmapRequests unscoped (returns any professor's requests) — also a
  privacy concern, Stage 6/9.
- B-46: admin broadcast has no recipient preview/confirm; dedupe-block renders as
  success; fields keep values after send.
- A-12: /support auto-reply path (`/상담|예약|시간/`) returns ok:true, creates no
  ticket, offers no escalation.
- A-18: overdue todos silently vanish from the dashboard card (mypage disagrees).
- A-22: 여러 수업 시간 입력 is a raw-JSON textarea; parse errors are silently
  dropped (a proper row UI exists twice elsewhere).
- A-25/A-26: community composer forces a 유사 글 review step even with no matches;
  post detail lives in the third sidebar column below two recommendation rails.
- Student reservation CANCEL action: RESOLVED in Stage 5 (2026-08-12) —
  cancelMyCounselingRequest (D-014), CAS pending|approved→cancelled scoped to
  the owning student, minimal UI button, rendered-verified live (booking
  cancelled, slot count restored in place, professor notified).
- Systemic (Stage 4 documented, not unified): Tailwind-vs-globals.css breakpoint
  schism (640/768/1024 vs 620/700/900); 9+ date-format implementations (2 use
  browser-local time); dead ui primitives (Badge/Select/Popover) vs 38 raw
  selects and 5 badge implementations; 19 raw `"button button-*"` class strings;
  counseling status vocabulary drift (거절/시간 조정/반려); C-31 mobile sticky
  header doesn't span the viewport; C-34 site footer (약관/사업자 정보)
  display:none on mobile with no alternative route; C-37 sub-16px inputs trigger
  iOS focus zoom; D-7 zero aria-invalid/aria-describedby app-wide; D-17 no skip
  link; D-18 heading-hierarchy gaps; C-35 undocumented z-index ladder (community
  FAB z-55 paints above dialogs).
- Rendered-QA observation (once, UNVERIFIED cause): immediately after a booking
  submit, one navigation bounced to /dashboard (role-guard redirect class); not
  reproducible on retry — the second full booking loop stayed in place.

## KI-016 — Stage 3 performance audit findings deferred by design (Stage 4/6/8/9 inputs)

Status: OPEN, partially addressed in Stage 4 (2026-08-12):
- Loading states: ATTEMPTED and REVERTED — route-level loading.tsx reproduces the
  KI-013 stuck hydration fallback on this app (D-010, commit 99bf213). Still open,
  needs a non-Suspense mechanism.
- Nested <main> instances: FIXED (community/reviews/lounge/weekly-plan-preview +
  guard test no-nested-main.test.mjs).
- Rerender hotspots: hero carousel interval churn fixed (pause + 5s cadence);
  hover-glow-card and ai-tutor-chat keystroke rerenders unchanged.
- Report labeling fixed (course names); SCOPING still open (privacy, Stage 6/9).
- Still open: supabase-js in shared shell, unbounded queries + index candidates,
  dashboard student_courses 5× reads.
Original text follows.
- Professor report services read university-global data (ALL course_offerings +
  ALL student progress rows, unscoped to the signed-in professor) and serialize
  it into client props (professor-course-progress-report.server.ts:~195,
  professor-anonymous-weekly-aggregate.server.ts:~280). Also a privacy concern —
  any professor sees every student's progress. Scoping changes displayed
  content, so it was out of Stage 3's behavior-preservation charter.
  Recommended: Stage 6 (tenancy) / Stage 9 (authz), severity Medium.
- Unbounded result sets fine at demo scale: courses full table (course.service.ts,
  student-community.service.ts getCourses), course_professors fallback
  (counseling.service.ts:128-130), escalations inbox + student /ask full-table
  read (professor-questions.server.ts), getCalendarRequests, course notices
  (course-notices.server.ts:36-43), posts' reactions/comments for 80 posts.
  Recommended: Stage 8, severity Low today / Medium at scale.
- Justified-by-pattern index candidates, negligible at 126-row scale:
  user_notifications partial unread indexes; student_weekly_progress
  (offering_id, week_number) once professor scoping lands; counseling_requests
  (student_id, created_at desc). Recommended: Stage 8.
- No loading.tsx/streaming anywhere: every navigation blocks on full SSR with a
  frozen previous page (client-nav RSC 268–852 ms measured). Loading-state
  design belongs to Stage 4 (§23); revisit with post-Stage-3 numbers.
- supabase-js rides in the shared shell (~72 kB gz on every route) via
  NotificationMenu for a realtime channel that is off by default
  (notification-menu.tsx:73). Extraction candidate, Stage 4/8.
- Rerender hotspots (no measured journey impact yet): hover-glow-card mousemove
  setState (dashboard), ai-tutor-chat per-keystroke full re-render, hero
  carousel interval churn; nested <main> also in community-board.tsx:399,
  reviews-board.tsx:136, professor-lounge.tsx:93. Stage 4.
- /dashboard still reads student_courses 5× per render with different
  selects/filters (getMyCourses, course notices, page inline, offering
  resolution, ownership gates) — a true consolidation needs a shared
  student-courses snapshot type, deferred. Stage 4/8, severity Low.

## KI-013 — Professor workspace intermittently never leaves its lazy-load fallback

Status: RESOLVED in Stage 3 (2026-08-12, commit b4bfe9f). Stage 4 addendum: the
pathology GENERALIZES — route-level loading.tsx reproduced the identical stuck
fallback (orphaned SSR DOM, dead page, no console errors) on every route it was
added to; reverted and codified as D-010 (no route-level Suspense seams). Root cause: the
"[Opt 4]" `next/dynamic()` wrapper in the Server Component page created a
Suspense/lazy hydration seam while deferring nothing — the workspace chunk was
eagerly preloaded for /professor in app-build-manifest.json, and direct GET
loads reproduced the stuck fallback 4/4 (≥29 s, orphaned SSR DOM, 2 nested
<main>, all chunks 200, no console errors) on the production build. Fix:
static import (seam deleted), workspace's nested <main> → div, redundant
inline dynamic import of professor.actions removed. After: 8/8 direct GETs
render the workspace (desktop + mobile + ?tab=report deep link) across two
production builds; /professor First Load JS unchanged then reduced 339→225 kB
by re-introducing lazy loading at the correct boundary (recharts report view
inside the client workspace, ssr:false — no RSC hydration seam). Guarded by
src/app/professor/professor-page-hydration.test.mjs. Historical text below
kept for context.

Previously: /professor rendered the SSR'd workspace, then hydration replaced it with the
"워크스페이스 불러오는 중..." fallback which never resolved; the SSR'd workspace HTML
remained orphaned in the DOM (nested `<main>`, width 0). All JS chunks returned 200; no
console/server errors. Flaky: loads arriving via the login POST redirect reliably
hydrated during QA; direct GET navigations frequently stuck. Reproduced identically on
`main` (d922b34) and `upgrade/stage-2` production builds, same machine/browser.
Note: Stage 2 QA also hit a SEPARATE, Stage-2-caused variant (relative .ts-extension
import broke webpack dev's client graph) — that one was fixed on the stage-2 branch
(calendar-utils imports via the @/ alias again; tests use a transpile loader).

## KI-014 — Availability writes lack ownership/role guards; counseling status updates lack ownership checks

Status: OPEN (security hardening — fold into the KI-006/KI-011 RLS migration family,
Stage 9). Evidence from the Stage 2 discovery sweep (2026-08-12):
- `addProfessorAvailability` / `toggleProfessorAvailability`
  (professor.actions.ts:118,528) have NO role or ownership check and write via the anon
  client under the permissive `demo anon manage professor availability` policy
  (schema.sql:501, `using (professor_id is not null)`) — any caller can open/block any
  professor's availability.
- `updateCounselingStatus` (professor.actions.ts) checks role only, not ownership:
  any professor/assistant can move any request via the service-role client.
  Stage 5 (D-012) added the from-state CAS and a legal transition matrix, so
  impossible/backward transitions are gone — but the OWNERSHIP hole remains
  Stage 9 scope. Stage 5 also added cancelMyCounselingRequest (D-014) using the
  same service-role + app-predicate pattern; include a student self-cancel
  policy in the Stage 9 RLS overhaul list.
- anon retains an UPDATE grant on counseling_requests plus a hardcoded-demo-email anon
  UPDATE policy (schema.sql:507-523) never dropped by migration 20260713090000.

## KI-015 — Assorted counseling-domain paper cuts (documented during Stage 2, out of scope)

Status: PARTIALLY RESOLVED in Stage 4 (2026-08-12):
- FIXED: reject flow's hard-coded 30-min suggested window — now spans the
  originally requested duration (commit 6b87ea2); the "(선택)" label lie and the
  silently-dropped unparseable time are also gone (datetime-local + required).
- FIXED: dead component professor-admin-summary.tsx deleted (commit cb88917).
- RECLASSIFIED: the "상담 슬롯 counts inactive rows" stat tile is currently DEAD
  COMPUTATION — adminStats is computed and passed but never rendered (Stage 4
  audit B-27); either render it with the corrected filter or delete it.
- Cancel notification text bug: RESOLVED in Stage 5 (2026-08-12, D-012) —
  cancelled transitions send honest copy ("상담 예약이 취소됐습니다", no phantom
  추천 시간 promise); behavior-tested. STILL OPEN: approve/cancel null out
  professor_note and suggested_* unconditionally (now tracked in KI-018).
- Schema drift: `suggested_start`/`suggested_end`/`location` exist only in schema.sql
  (no migration adds them); `offering_id` exists only in migration 20260712000000 (not
  in schema.sql's table body). Reconcile with the migration-history cleanup (KI-006
  note, Stage 10).
- Three test files under supabase/migrations/*.test.mjs are never run by the canonical
  `node --test "src/**/*.test.mjs"` glob; no `test` script exists in package.json
  (Stage 10 CI).

## KI-012 — Dashboard ownership gates errored on duplicate student_courses rows

Status: FIXED 2026-08-12 (Red → Green; latent — no live occurrence at fix time).
The KI-006 app-level ownership gates in course-term-completion-eligibility.server.ts and
student-learning-recommendations.server.ts used a bare `.maybeSingle()` on
`student_courses (student_id, offering_id)`. The table is unique on (student_id, course_id,
STATUS), so one student can own the same offering via several rows (e.g. an "interested"
registration next to a "completed" row linked by the roadmap repair flow,
personalized-weekly-roadmap.server.ts:175). supabase-js `maybeSingle()` errors on >1 row,
which would have broken the dashboard cards for exactly those students. Live check
2026-08-12: 0 duplicate (student, offering) pairs today (7 offering-linked rows, all
`interested`) — latent, one flow away, so no runtime repro was manufactured.
Fix: `.limit(1).maybeSingle()`, the same idiom the roadmap server's authorization check
already uses (frozen by student-roadmap-workspace.test.mjs). RED:
src/services/offering-ownership-gate.test.mjs 2/2 fail for the intended reason → GREEN 2/2
pass; full suite 150/147 pass/3 fail (same KI-002 trio); typecheck clean.
Found by external real-time review (P2); premise verified against schema and live data.

## KI-011 — SECURITY DEFINER RLS helpers live in the exposed public schema

Status: OPEN (hardening; fold into Stage 2 RLS work — flagged by external review 2026-08-12).
is_professor_of_offering / is_student_of_offering (migration 20260812000000) are SECURITY
DEFINER functions in `public`, so PostgREST exposes them as RPC endpoints to the
authenticated role. Mitigations already in the migration: EXECUTE revoked from public/anon
(authenticated only), both predicates answer only about the caller (auth.uid() is evaluated
inside — no cross-user disclosure), and search_path is pinned to `public` (not mutable).
Residual risk is low: an authenticated user can merely probe their own membership of
arbitrary offering ids. Supabase guidance still prefers a non-exposed schema (e.g.
`private`) and `set search_path = ''` with fully qualified names. Do that in the Stage 2
RLS unification (same migration family as KI-006/KI-007) instead of churning the live DB now.

## KI-010 — Vercel build failed: pnpm-lock.yaml out of sync (ERR_PNPM_OUTDATED_LOCKFILE)

Status: FIXED 2026-08-12.
The repo ships both `package-lock.json` (npm — what local dev/CI actually used, per
SYSTEM_BASELINE.md) and a committed `pnpm-lock.yaml` + `pnpm-workspace.yaml`. Vercel
auto-detects the package manager from whichever lockfile is present and picked pnpm; that
lockfile was stale (`tw-animate-css` was added to `package.json` without regenerating
`pnpm-lock.yaml`), so Vercel's `pnpm install --frozen-lockfile` failed with
`ERR_PNPM_OUTDATED_LOCKFILE`, blocking the deploy for PR #32.

Fix: ran `pnpm install --lockfile-only` to resync `pnpm-lock.yaml` with `package.json`, then
verified with `pnpm install --frozen-lockfile` (the exact mode Vercel/CI use) and a full
`npm run build`. `npm ci` was also re-verified to still succeed, so both lockfiles are
consistent with `package.json` again.

**How to apply / avoid recurrence:** whenever a dependency changes in `package.json`, run
`pnpm install --lockfile-only` (in addition to whatever `npm install` already updates) before
committing — two lockfiles means two things to keep in sync. A commit
(`6187549 fix: sync pnpm lockfile for vercel builds`) shows this has broken before. Consider
removing one lockfile/manager entirely in Stage 10 (CI/CD hardening) so this class of failure
becomes structurally impossible instead of process-dependent.

## KI-001 — Professor calendar availability engine diverges from canonical student engine

Status: RESOLVED in Stage 2 (2026-08-12). The duplicate engine was deleted; the
professor calendar consumes `buildProfessorWeekAvailability`, whose bookable claim
derives exclusively from the canonical per-date primitive. Undeclared free time now
renders as "상담 미개방" (not student-bookable); declared bookable time keeps
"상담 가능" and matches the student engine exactly (identity-level regression test in
src/lib/availability-consistency.test.mjs; live QA 2026-08-12: 김재두 zero-declaration
baseline 0 상담 가능 / 82 미개방 chunks; declared Mon 10:00-11:00 window → 2 상담 가능
chunks == student side 2개 on both horizon Mondays). Timezone handling is Asia/Seoul
throughout (D-006). Historical text below kept for context.

Previous status: PARTIALLY FIXED in Stage 1 (2026-08-11); remainder deferred to Stage 2.
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

Status: MOSTLY RESOLVED in Stage 4 (2026-08-12, commits 4431bcc + b46fd34):
- Month paging: FIXED — months derive from the slot range with labeled prev/next
  controls; rendered-verified with a booking loop.
- Post-booking staleness: FIXED — router.refresh() on success, message beside the
  action, selection cleared; rendered-verified (2건 badge + slot count updated in
  place).
- Second-professor picker: FIXED — courses with >1 professor render selection
  chips in step 2 (rendered-verified on 담보물권법).
- STILL OPEN: demo student login lands on /onboarding although onboarding data
  exists (cause UNVERIFIED).

## KI-006 — RLS policy recursion (42P17) on course_offerings

Status: DB FIX APPLIED 2026-08-12 — the owner ran
20260812000000_fix_offering_policy_recursion.sql in the SQL editor; verified via PostgREST
that student and professor authenticated reads of course_offerings / student_weekly_progress /
student_course_progress no longer return 42P17. App-level admin-client workarounds remain in
place (harmless; candidates to revert to session reads in Stage 2).
Root cause: mutually recursive authenticated policies — "students read own course offerings"
(20260712183907, subqueries student_weekly_progress) ⇄ "professors read own weekly aggregate
evidence" (20260713013521, subqueries course_offerings). Every authenticated SELECT on
course_offerings fails with 42P17. Reproduced live with a student JWT via PostgREST.

Consequences and current state (reconciled 2026-08-12 after the DB fix):
- Student dashboard 학기 완료 근거/다음 학습 추천 cards were dead → FIXED at app level
  (ownership gate via own student_courses row + server-only admin-client reads scoped to the
  verified ids) in course-term-completion-eligibility.server.ts,
  student-learning-recommendations.server.ts, company-law-offering.server.ts. With the DB
  fix applied these workarounds are redundant; revert to session reads in Stage 2.
- Professor 과목 진행 현황 report: was broken (error panel) while the recursion existed;
  confirmed rendering real data live after the DB fix (commit f2f490d). The 익명 주간 집계
  view is expected fixed by the same policy change but was not separately re-verified —
  UNVERIFIED. professor-anonymous-weekly-aggregate-security.test.mjs still (correctly)
  forbids service-role reads there.
- supabase/migrations/20260812000000_fix_offering_policy_recursion.sql was applied manually
  via the SQL editor, NOT `supabase db push` — the CLI migration history table may not list
  it as applied. Reconcile migration history before the next `db push` (Stage 2/10).

## KI-007 — student_profiles/student_courses authenticated policies use pre-mapping identity

Status: OPEN (app-level workaround in place for login).
Authenticated policies still compare `auth.uid()` to `profile_id`/`student_id` (= profiles.id),
which never matches after the auth_user_id mapping (20260712183855/183907 fixed only
`profiles`). Effect observed: login's is_onboarded read returned 0 rows → every student was
redirected to /onboarding despite is_onboarded=true. FIXED at app level in
demo-auth.service.ts (admin-client read of the just-verified profile id). DB-layer policy
update belongs with KI-006's migration family (Stage 2/9).

## KI-008 — External images on i.ibb.co are slow (5–12 s, 0.9–1.3 MB each)

Status: RESOLVED 2026-08-12 (owner-approved).
All 6 images (header logo, chatbot FAB, 4 hero banners) were downloaded, resized to display
dimensions, and vendored into public/images/ (~444 KB total vs ~6.6 MB originals). Sources
updated (app-header-professor-safe.tsx, app-shell.tsx, student-hero-carousel.tsx + its test);
i.ibb.co removed from next.config.mjs remotePatterns and CSP img-src. The carousel test now
guards against the external host returning (doesNotMatch i.ibb.co).

## KI-009 — Mobile touch-target sizes below guideline

Status: RESOLVED in Stage 4 (2026-08-12, commit 0e5c5f6 + aa4f4a3). Carousel dots
now sit in 32px hit areas (prev/next 40–44px, plus a pause control); 공지 닫기
24→36px (both banner and feed); both 마이페이지에서 관리 links get 44px-tall hit
areas; every Radix dialog close X gets p-2 padding (16→32px). Residual sub-44px
targets inventoried in the Stage 4 audit (C-22/C-23: 40px section tabs, .button-sm
34px, h-9 inputs) are recorded, not blocking. Historical text below.
Previously: 375px audit on 2026-08-12: carousel dots 10×10 px, 공지 닫기 24×24 px,
"마이페이지에서 관리" links ~17–20 px tall (guideline ≈44 px). elementFromPoint
interception audit at scroll-top found zero blocked targets on dashboard/mypage.

## KI-005 — supabase/schema.sql snapshot has a duplicate column line

Status: OPEN (latent). `professor_admin_tasks` in supabase/schema.sql (~:910-911) repeats
`day_of_week` — harmless unless the snapshot is re-applied verbatim; real migration
(20260714204100) is correct.
