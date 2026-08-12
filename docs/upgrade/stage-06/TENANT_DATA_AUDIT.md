# Stage 6 — Tenant Data Audit

Date: 2026-08-12. Evidence: four parallel read-only discovery agents (A: data
model/migrations, B: auth/RLS, C: reservation/RPC/constraints, D:
client/cache/API) reconciled by the lead session, PLUS direct live-DB
introspection via the linked Supabase CLI (`npx supabase db query`,
information_schema + pg_constraint + pg_indexes + pg_policies, 2026-08-12).

## 0. Source-of-truth ruling

`supabase/schema.sql` is NOT canonical. It is a hand-maintained snapshot
frozen ~2026-07-04 with fragments pasted in later; it is not executable
(duplicate `day_of_week` on professor_admin_tasks ~:910 [KI-005], invalid
`do $$$` quoting :1008/:1017, mojibake defaults, policies referencing a
column the same file never declares) and it is missing 28 live tables.

Canonical order of authority for Stage 6:

1. LIVE database introspection (captured this session; scratchpad
   `live_columns/constraints/indexes/policies.json`)
2. The migration chain `supabase/migrations/*.sql` (40 files) — matches live
   for everything it covers
3. schema.sql — used only as evidence for the handful of live columns no
   migration created (they were hand-applied): counseling_requests
   `suggested_start`/`suggested_end`/`location`; posts `school_id`,
   `board_key`, `display_mode`, `anonymous_alias`, `view_count`,
   `is_resolved`, `resolved_by_post_id`; notices `course_id`;
   student_courses `understanding_status`/`current_week`.

Live-verified facts that override repo files:

- 53 tables exist live. `course_weekly_missions` and `timetables` exist ONLY
  in schema.sql — they are NOT live and are excluded from this audit.
- `counseling_requests_no_active_overlap` EXCLUDE USING gist
  (professor_id WITH =, tstzrange(requested_start, requested_end,'[)') WITH
  &&) WHERE (status IN ('pending','approved')) — EXISTS live (pg_constraint).
- Remote migration history is missing `20260812000000` (applied via SQL
  editor, KI-006) — must be `migration repair`-ed before any `db push`.
- Live data scale (2026-08-12): schools 1, departments 2, profiles 27,
  professors 3, courses 9, counseling_requests 3, professor_availability 9,
  user_notifications 129, student_weekly_progress 90; everything else ≤ 30.

## 1. The existing tenant concept

The tenant entity ALREADY EXISTS: `public.schools` (id uuid PK, name text
UNIQUE, created_at). One live row: 계명대학교
(`862b661c-810a-4440-ba76-722b2fcf8d6a`), seeded by the initial migration and
hardcoded in several seed files.

Exactly six columns reference it today:

| Column | Nullability | Referential action | Populated live? |
|---|---|---|---|
| departments.school_id | NOT NULL | CASCADE | yes (2/2) |
| curriculum_versions.school_id | NOT NULL | RESTRICT | yes |
| profiles.school_id | NULLABLE, **mutated at runtime** | none | NO (sampled rows NULL) |
| courses.school_id | NULLABLE | none | partial |
| posts.school_id | NULLABLE | SET NULL | partial (client-supplied!) |
| academic_terms.school_id | NULLABLE | SET NULL | dual-mode by design |

Single-tenant assumptions baked into code (break the moment a 2nd school row
exists):

- `student-community.service.ts:112-126` — lazily WRITES the first school in
  the table onto any profile whose school_id is NULL.
- `onboarding.actions.ts:192-219` — falls back to the first `schools` row.
- `community-board.tsx:269,279` — posts.school_id supplied from a CLIENT form
  field (`courses[0]?.school_id`).
- `professor.service.ts:186-194` — `getCurrentProfessor` falls back to the
  globally-first professors row (KI-017 B-24); cross-tenant identity theft
  under multi-tenancy.
- Seeds `raise exception` unless exactly one 계명대학교 row exists.

There is no `student_number` column anywhere; `profiles.identifier` (login
key, globally UNIQUE) is the only human-facing identity key.

## 2. Classification

Legend: TS = tenant-scoped, TS-D = tenant-scoped with tenancy DERIVED via an
immutable NOT NULL FK chain (no own tenant column needed), PG =
platform-global, UG = user-global, AMB = ambiguous (decision recorded in
DESIGN.md).

### 2.1 Tenant root & org structure

| Table | Class | Tenancy mechanism |
|---|---|---|
| schools | tenant registry itself | n/a — IS the tenant table |
| departments | TS | own school_id (NOT NULL, CASCADE, unique(school_id,name)) — already correct |

### 2.2 Identity

| Table | Class | Tenancy mechanism / decision |
|---|---|---|
| profiles | AMB → decided: identity + single-tenant membership (see DESIGN §3) | school_id must become backfilled + immutable-in-app; identifier uniqueness decision in DESIGN §3.3 |
| student_profiles | UG (follows profile) | derived via profile_id (NOT NULL UNIQUE CASCADE) |
| professors | TS | department_id NULLABLE breaks the chain → needs own school_id NOT NULL (denormalized); the counseling domain's tenant anchor |

### 2.3 Catalog (TS via `courses.school_id` once NOT NULL)

| Table | Class | Chain |
|---|---|---|
| courses | TS | own school_id — must become NOT NULL (currently unique(school_id, code) is NULL-leaky) |
| course_professors | TS-D | course_id NOT NULL CASCADE → courses.school_id |
| syllabi | TS-D | course_id NOT NULL CASCADE (storage_path stays globally unique) |
| academic_terms | AMB → decided: keep dual-mode (school term OR platform-global term) for now; documented risk | own school_id nullable + two partial unique indexes |
| course_offerings | TS-D | course_id NOT NULL CASCADE → school; strongest chain in schema; also professor_id/term_id NOT NULL RESTRICT |
| course_weekly_plans | TS-D | offering_id NOT NULL CASCADE |
| course_schedules / course_assessments | TS-D | course_id NOT NULL CASCADE |

### 2.4 Student learning state (all TS-D through offering_id or course_id)

student_courses (course_id chain; integrity risk: nothing stops student(A) ×
course(B) — closed by the server boundary in Stage 6, DB trigger deferred),
student_course_schedule_slots, student_course_progress,
student_weekly_progress (highest-sensitivity leak target: private notes),
student_personalized_weekly_roadmaps, student_course_study_guides,
student_mission_progress (RLS wide open today — using(true)),
study_roadmaps, study_tasks, student_course_records,
student_curriculum_assignments (active-assignment uniqueness stays
user-global deliberately), roadmap_results (via request_id).

| Exception | Class | Mechanism |
|---|---|---|
| student_custom_courses (+slots) | UG | personal calendar items; parent = profiles only |
| roadmap_requests | UG-ish legacy | parent = profiles only; superseded by offering-based tables |

### 2.5 Professor scheduling & counseling (all TS via professors)

professor_availability, professor_teaching_slots, professor_admin_tasks,
counseling_requests, professor_question_auto_reply_rules — all
professor_id NOT NULL CASCADE → professors. Chain becomes reliable once
professors.school_id exists (department_id hop is nullable today).

### 2.6 Q&A / chat / notifications

| Table | Class | Decision |
|---|---|---|
| escalations | TS-D | course_id NOT NULL RESTRICT → courses.school_id |
| chat_sessions / chat_messages | AMB → decided UG-owned (user_id), offering link optional; tenant reads derive via user | both FKs nullable; no own column added in Stage 6 |
| user_notifications | TS, NEEDS OWN school_id | broadcast rows (recipient_id NULL) have NO derivable parent — the #1 cross-tenant leak by construction |
| notices | TS, needs own tenant column eventually | Stage 6: no live rows (0); documented, column added in migration for completeness |
| faqs | AMB | all parent FKs nullable SET NULL; 1 live row; deferred with documentation |
| roadmap_revision_requests | TS but unlinkable (string targets: department_name, course_id text) | needs own school_id; 0 live rows |

### 2.7 Community

| Table | Class | Mechanism |
|---|---|---|
| posts | TS | own school_id — must become server-derived (never client-supplied) and backfilled; NOT NULL deferred until backfill verified |
| comments / post_reactions | TS-D | post_id NOT NULL CASCADE |
| course_reviews | AMB → decided TS | course_id chain; 0 live rows; course_id NULLABLE SET NULL today |
| reports | AMB → decided: stamp school_id at insert from reporter | polymorphic target, no chain possible; 0 live rows |

### 2.8 Curriculum subtree (model citizen)

curriculum_versions carries school_id + department_id NOT NULL RESTRICT;
all 9 children derive 1–2 hops through NOT NULL CASCADE FKs. Already
tenant-aware uniqueness (`curriculum_versions_identity_idx`). Only wart:
`course_equivalencies_identity_idx` coalesces NULL curriculum_version_id
into a shared zero-UUID bucket (cross-tenant namespace) — documented, 0
affected live rows.

### 2.9 Platform-global resources

NONE exist legitimately today. The two accidental global namespaces
(academic_terms global-semester mode; course_equivalencies zero-UUID bucket)
are documented as risks, not endorsed as platform data.

## 3. Uniqueness audit (decisions)

| Constraint | Scope today | Stage 6 ruling |
|---|---|---|
| profiles.identifier UNIQUE | GLOBAL | KEEP GLOBAL for Stage 6. identifier is an email-shaped login handle (`*@pacemate.local`, `*@pacemate.edu`, numeric admin ids); login (`session.service.ts`) resolves by identifier with no tenant predicate. Making it tenant-local requires tenant-qualified login UX (Stage 7 SSO territory). Documented as the Stage 7 breaking point; a same-identifier-two-tenants signup is impossible while signup doesn't exist (demo auth only). |
| schools.name UNIQUE | global | keep — tenant registry key |
| departments (school_id, name) | tenant-local | already correct |
| courses (school_id, code) | tenant-local but NULL-leaky | fix by making school_id NOT NULL after backfill |
| counseling GiST + confirmed_slot_idx | professor-local | inherently tenant-local; DO NOT TOUCH (see §4) |
| professors — none | — | add unique(school_id, email) deferred (emails not guaranteed present); documented |
| academic_terms global idx | global singleton | keep + document; forbid via app (no code creates NULL-school terms) |
| escalations (user_id, submission_key) | user-global | correct (idempotency key) |
| profiles.auth_user_id partial unique | user-global | correct; the exact seam Stage 7 SSO must revisit for multi-affiliation |
| syllabi.storage_path unique | global | correct — storage object keys are a global namespace; tenant prefixing documented as Stage 7/8 follow-up |
| All offering/curriculum identity indexes | tenant-local via parents | correct as-is |

## 4. Stage 5 constraint re-evaluation (spec §12)

Question 1 — could a reservation at University A incorrectly conflict with an
identical slot at University B? **No.** Both the GiST exclusion constraint and
the partial unique index key on `professor_id` (uuid PK, globally unique). Two
universities' professors are distinct ids; cross-tenant false conflicts are
structurally impossible. Verified against the live constraint definition.

Question 2 — could adding tenant scope allow two conflicting reservations
within one university? **Yes — which is exactly why the constraint must NOT
gain a tenant column.** Adding `school_id WITH =` to the exclusion key would
EXEMPT any row pair where school_id differs or is NULL (NULL comparisons are
not-true in exclusion operators), so a mis-backfilled or moved professor
would silently lose overbooking protection. The Stage 5 DESIGN §13 claim is
CONFIRMED and strengthened: `counseling_requests_no_active_overlap` stays
byte-identical; any future denormalized counseling tenant column must never
enter the exclusion key.

D-013 idempotency self-match: tenant-safe (bounded by student_id = caller on
the session client). One interaction documented in DESIGN §8: the tenant
check must run BEFORE the self-match so a legacy cross-tenant active booking
is not re-acknowledged as success.

D-012 transition CAS: the from-state predicate is tenant-neutral; the
missing piece is an OWNERSHIP predicate (professor_id = caller) in the same
single UPDATE — Stage 5 deferred it as a same-tenant defect (Stage 9), but
multi-tenancy upgrades it to a cross-tenant write and Stage 6 closes it.

## 5. Cross-tenant exposure inventory (server/API surface)

Ranked, from agents B/C/D reconciled; each row maps to a matrix row in
ISOLATION_TEST_MATRIX.md:

1. Professor directory: `getCounselingProfessors` reads ALL professors
   (name/email/office/bio) with `using(true)` RLS — rendered to every
   student as a searchable, bookable list (counseling.service.ts:196-216).
2. Booking authority: `createCounselingRequest` never checks
   professor↔student tenant relationship before INSERT
   (counseling.actions.ts:93); availability/teaching/admin-task feeds
   unscoped; course fallback degrades to ALL course_professors when the
   student has no courses (counseling.service.ts:134-136).
3. Status transitions: `updateCounselingStatus` (admin client) has role gate
   only, no ownership predicate — any professor/assistant can move ANY
   request platform-wide (professor.actions.ts:239-250); same for
   `updateCounselingDetails` (:317-324, no CAS either).
4. Availability writes: `addProfessorAvailability`/`toggleProfessorAvailability`
   write via the ANON client with FormData-supplied professor_id and zero
   ownership check (professor.actions.ts:119-167, :569-590; KI-014).
5. Notifications: role-broadcasts (recipient_id NULL) reach every user of
   that role at every university; `user_notifications` has no tenant column.
   RPC `approve_course_weekly_plan` fan-out is tenant-blind.
6. RPC `answer_professor_questions`: `role='assistant'` bypasses the
   professor-ownership predicate entirely — assistant at A can answer B's
   questions (20260714134426:65,:80).
7. Professor reports: course-progress + anonymous-weekly-aggregate read ALL
   offerings/progress platform-wide (KI-016, known privacy finding).
8. `getRoadmapRequests` unscoped (KI-017 B-31).
9. Busy feed `getBusyRequests`: unbounded platform-wide read — CORRECT
   result-wise (busy rows for foreign professors are inert in the domain
   engine) but O(all tenants) per render; tenant-filter as perf/minimization,
   NOT as an isolation control (D-011 authority preserved).
10. `getCurrentProfessor` first-row fallback = cross-tenant identity
    assignment (KI-017 B-24).
11. Wide-open RLS residue: student_mission_progress using(true);
    counseling demo-anon SELECT using(professor_id is not null); anon UPDATE
    policy gated on a hardcoded @kmu.ac.kr email (KI-014).

## 6. Auth / RLS / authorization (Agent B, reconciled)

### 6.1 Authentication architecture

Two parallel identity mechanisms minted by the same login action
(`demo-auth.service.ts`): (A) real Supabase Auth SSR cookies (`sb-*`,
refreshed by middleware — middleware does NOTHING else: no route protection,
no tenant resolution) and (B) a self-issued HMAC cookie `pacemate_session`
(`{profileId, role, issuedAt, expiresAt}`, HMAC-SHA256 with
`PACEMATE_SESSION_SECRET`, 8h TTL). `getDemoProfile()` (React-cached) trusts
the demo cookie first and falls back to Supabase Auth. **No tenant claim
exists anywhere in the request path** — but the profile row it returns
already carries `school_id`/`department_id`, so per-request tenant
resolution needs no new mechanism: it is `profile.school_id` once backfilled.

Consequence that bounds Stage 6's RLS ambitions: when the Supabase Auth
cookie is absent/expired but the demo cookie is valid, all session-client DB
reads run as **anon**. Server actions also DELIBERATELY use the anon client
for several write families because the authenticated policies are
pre-auth-mapping and never match (KI-007; comments in professor.actions.ts:8
and ai-tutor.actions.ts:3-7 say so explicitly). Therefore anon-role grants
and broad `using(true)` SELECT policies cannot be tightened without breaking
the app's own read/write paths — that untangling is the Stage 9 RLS overhaul
(KI-007/KI-011/KI-014 family). Stage 6 enforces tenancy at the trusted
server boundary and in the DB schema, plus narrowly-safe policy/RPC fixes
(§6.4), and documents the PostgREST-direct residual per table (§6.5).

### 6.2 Role model as implemented

`public.user_role` enum: student | professor | assistant | admin, stored on
`profiles.role`, duplicated into the signed cookie and cross-checked on
read. No roles join table, no per-tenant role. Page gates via
role-guard.service (student pages redirectNonStudent; /admin →
assistant|admin; /professor → professor|assistant). `admin` is an app-layer
string with no elevated DB identity. Tenant scope of each role after Stage
6: student/professor/assistant/admin all act WITHIN profile.school_id; no
platform-level cross-tenant role exists or is introduced (no operational
need — decision in DESIGN §5).

### 6.3 Service-role usage (the de-facto authorization layer)

38 call sites of `createSupabaseAdminClient()` (full table in Agent B's
register, reproduced in DESIGN appendix). Six carry NO caller-derived
predicate: busy feed ×2 (D-011, deliberate), `updateCounselingDetails`
(.eq(id) only — defect), curriculum draft queries ×2 (department-name
string, no identity), company-law context (hardcoded course+semester).
Three take an unvalidated identity parameter (course-notices studentId,
weekly-progress studentId, and everything downstream of the
`getCurrentProfessor` first-row fallback). The rest carry ownership
predicates (student_id/professor_id = caller) that are tenant-safe because
ids are globally unique.

### 6.4 Anon-principal exposure (headline items)

- profiles: anon SELECT/INSERT/UPDATE `using(true)`-equivalent — including
  role and auth_user_id rewrite (privilege escalation), pre-existing KI-014
  family, Stage 9.
- counseling_requests: anon UPDATE policy gated on a hardcoded professor
  email (`zivilprozess_park@kmu.ac.kr`) — dead (no app path), dropped in
  Stage 6.
- roadmap_revision_requests: anon+authenticated UPDATE (anyone approves any
  university's curriculum revision) — app's own updateRoadmapRevisionStatus
  uses the anon client with NO role gate; Stage 6 candidate (move to admin
  client + role gate, then drop the demo review policy).
- user_notifications: SELECT/INSERT/UPDATE for anon+authenticated (every
  notification readable by anyone) — reads must stay until Stage 9 (header
  reads run as anon in demo-cookie-only state); Stage 6 adds the tenant
  column + scopes app reads/writes.
- escalations: `assistants read professor questions` — any assistant reads
  every question platform-wide; RPC `answer_professor_questions` lets
  assistants ANSWER any question (v_staff_role='assistant' bypasses the
  ownership predicate). Stage 6 fixes both with school predicates.
- student_mission_progress / course_weekly_missions: `using(true)` ALL for
  anon+authenticated — ai-tutor writes depend on the anon path; Stage 9.
- professor_admin_tasks: authenticated SELECT `using(true)` — feeds the
  availability engine via session client (may be anon); Stage 9 for RLS,
  Stage 6 scopes the app read.

### 6.5 KI-007 pre-mapping (never-matching) policy family

Survives on: profiles UPDATE (authenticated), all student_profiles
authenticated policies, student_courses `users manage own` ALL,
roadmap_requests/results, course_reviews INSERT/UPDATE, counseling_requests
professor SELECT branch + `professors update own counseling requests`.
These grant nothing (predicates never match) — the app works because anon
policies and service-role cover the gaps. Stage 9 replaces the family;
Stage 6 does not touch them (D-014 precedent: don't churn a known-wrong
family twice).

## 7. Client / cache / routes (Agent D, reconciled)

### 7.1 Caching — "nothing outlives a request" CONFIRMED, two caveats

Zero `unstable_cache`/`revalidateTag`/ISR/fetch-cache anywhere; all 23 pages
`force-dynamic`; build manifest shows no prerendered user routes. D-007
holds. `revalidatePath` (86 sites) degenerates to a per-browser Router Cache
bust — no tenant correctness impact today, but the path shapes carry NO
tenant segment, so a FUTURE `unstable_cache` on tenant-shared data would be
an unscoped invalidation surface (documented for Stage 8). Two caveats:

- Exception A: `roadmap/[courseId]/page.tsx:27` exports
  `generateStaticParams` on a force-dynamic, per-student-personalized route.
  Latent footgun; Stage 6 deletes it.
- Exception B: `lib/supabase/client.ts:3` is a module-scope anon-client
  singleton imported by server modules (survives across requests). Safe only
  because nothing calls `auth.*` on it; any future session mutation there
  would leak across requests/tenants. Documented, not changed in Stage 6.

### 7.2 Client state — cross-account/cross-tenant bleed on shared devices

- localStorage `pacemate_student_todos`, `pacemate_student_todo_done`
  (student-todo-card.tsx:7-8 + my-page-planner.tsx:493), and
  `pacemate.dismissed-course-notices.v1` (student-announcement-feed.tsx:16)
  are UNKEYED globals, cross-tab-synced, never cleared on logout → user B on
  a shared device sees user A's todos/dismissals. Community draft key IS
  profile-scoped (good) but never cleared.
- Zustand `app-store.ts:21` `cachedSessions` holds AI-tutor chat titles +
  message text; module singleton, never reset on logout (server redirect
  doesn't tear down the client runtime).
- No React Query/SWR/Redux/Context-holding-server-data; only Zustand.
- Stage 6 scope: key the localStorage buckets by profile id and clear
  client state on logout. These are real cross-tenant client leaks.

### 7.3 Routes / IDOR

No API routes exist — all mutations are server actions. Middleware does only
Supabase cookie refresh (no gating, no host/tenant logic). `/courses/[id]`
(`course.service.ts:26`, anon client, `using(true)`, no school filter) and
`/roadmap/[courseId]` are ID routes with no tenant/enrollment check — direct
cross-tenant enumeration. `/dashboard`, `/notices`, `/notifications` have no
role gate (data is ownership-filtered inside).

### 7.4 Realtime — CORRECTION to the Stage 3 assumption

The Stage 3 notes said the notification realtime channel is "off by
default". It is NOT: `app-header-professor-safe.tsx:347` passes
`enableRealtime` on the always-mounted desktop header, so it is live on
every authenticated view. The channel filters `recipient_id=eq.{profileId}`
CLIENT-SIDE over the anon socket, governed by the
`demo read notifications using (target_href <> '')` policy — i.e. the filter
is convenience, not a boundary; a crafted subscribe frame streams every
user's notification rows platform-wide. This is part of the anon-exposure
class (§7.5) and its full fix is the Stage 9 RLS overhaul; Stage 6 adds the
tenant column and scopes the app-issued reads/writes and broadcasts.

### 7.5 The anon-role reality (bounds Stage 6's DB-layer claims) — CRITICAL

`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` ships to every browser, so any RLS
policy granting `anon` is exploitable by direct `curl` regardless of app
gating. Live policies grant anon read/write on profiles, student_profiles,
student_courses, counseling_requests (SELECT), user_notifications
(SELECT/INSERT/UPDATE), roadmap_revision_requests, student_mission_progress,
professor_availability/teaching_slots/faqs, course_reviews, and read on the
whole catalog — most via `using(true)`-class predicates. This is the
KI-014/KI-007 demo-policy family, and the app's own server actions
DELIBERATELY depend on several of these anon paths (professor.actions.ts,
ai-tutor.actions.ts).

Consequence for Stage 6 honesty: a determined attacker holding the public
anon key can still read/write those demo-era tables directly at the DB layer
until the Stage 9 RLS overhaul lands. Stage 6 therefore:

1. Enforces tenant isolation authoritatively at the trusted SERVER boundary
   for every flow it owns (server actions + services + service-role paths) —
   this is real, testable, and the primary Stage 6 boundary.
2. Adds the missing tenant columns + tenant-aware RLS/`WITH CHECK` wherever
   it can be done WITHOUT breaking an anon-dependent path — notably the
   counseling INSERT (authenticated policy, D-011 era) gets a tenant
   backstop, and the new school_id tables get tenant RLS.
3. Removes narrowly-safe dead exposure (the hardcoded-email anon UPDATE
   policy on counseling_requests; the assistant cross-tenant answer bypass).
4. Precisely documents (KNOWN_ISSUES) which direct-PostgREST anon vectors
   remain open pending Stage 9, with evidence — never claiming a DB boundary
   that the anon grants defeat. Per the D-014 precedent, Stage 6 does NOT
   churn the known-broken anon/pre-mapping policy family twice.

## 8. Cross-tenant exposure master list → matrix rows

Reconciled and ranked across all four agents. Each maps to
ISOLATION_TEST_MATRIX.md. "Boundary" = which layer Stage 6 enforces at.

| # | Vector | Stage 6 boundary | Owner |
|---|---|---|---|
| X1 | Student books ANY professor (no tenant check before INSERT) | server action + counseling INSERT RLS WITH CHECK + isolation test | Stage 6 |
| X2 | Professor directory / availability / teaching / admin-task feeds unscoped | service query scoping + tenant filter | Stage 6 |
| X3 | Course-mode fallback returns ALL course_professors when student has none | service query scoping | Stage 6 |
| X4 | updateCounselingStatus / updateCounselingDetails: no ownership+tenant predicate (service role) | add professor+tenant predicate to the CAS statement | Stage 6 (risk class changed vs Stage 9 defer) |
| X5 | Notification role-broadcasts have no tenant dimension | add school_id column + scope app fan-out + reads | Stage 6 (column+app), Stage 9 (anon read RLS) |
| X6 | RPC answer_professor_questions assistant bypass (cross-tenant answer) | add tenant predicate in RPC | Stage 6 |
| X7 | Professor reports read ALL offerings/progress (KI-016) | tenant/ownership scope at server | Stage 6 |
| X8 | getRoadmapRequests / roadmap-revision reads unscoped (KI-017) | tenant scope at server | Stage 6 |
| X9 | createCommunityPost school_id from client form; ensureProfileSchool auto-assign | stamp from session; remove auto-assign | Stage 6 |
| X10 | Community board / catalog / reviews reads unscoped by school | tenant scope at server | Stage 6 |
| X11 | Busy feed O(all tenants) unbounded | tenant-filter for perf/minimization (NOT isolation; D-011 preserved) | Stage 6 |
| X12 | getCurrentProfessor first-row fallback = cross-tenant identity | scope fallback to tenant / fail closed | Stage 6 |
| X13 | Client localStorage/zustand cross-account bleed | key by profile + reset on logout | Stage 6 |
| X14 | /courses/[id], /roadmap/[courseId] IDOR | tenant check at page/service | Stage 6 |
| X15 | generateStaticParams on personalized route | delete | Stage 6 |
| A1 | anon wide-open RLS on profiles/student_*/counseling read/user_notifications/etc. via public key | documented residual; app paths scoped | Stage 9 (RLS overhaul) |
| A2 | KI-007 pre-mapping authenticated policies never match | documented | Stage 9 |
| A3 | syllabus-files bucket policies bucket-wide for all authenticated | documented; storage tenant-prefix | Stage 7/8 |
| A4 | Production CSP script-src 'unsafe-inline' | documented | Stage 9/10 |

Stage 5 constraint ruling (§4 above) is unchanged: DO NOT touch
`counseling_requests_no_active_overlap`.
