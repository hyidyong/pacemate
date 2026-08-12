# Stage 9 — Authorization Matrix and RLS Audit

Ground truth for this document was read from the **live database**, not from
`supabase/schema.sql`. The snapshot is stale and partly corrupt (D-2 / KI-005),
so it is not used as evidence anywhere below. Queries were run through the
Supabase Management API (`supabase db query --linked`) against `pg_policies`,
`information_schema.role_table_grants`, `pg_proc`, `pg_constraint` and
`pg_publication_tables`.

## 1. Object inventory and classification

53 tables in `public`, all with RLS enabled. Classification, and the state
before/after Stage 9:

| Class | Tables | anon before | anon after |
|---|---|---|---|
| **PUBLIC-BY-DESIGN** | `schools` | SELECT | SELECT (kept) |
| **TENANT-SCOPED catalog** | `courses`, `departments`, `professors`, `course_professors`, `syllabi`, `notices`, `faqs`, `course_reviews`, `professor_availability`, `professor_teaching_slots` | SELECT on all; **full CRUD** on availability, teaching slots, faqs; INSERT+UPDATE on reviews | none |
| **TENANT-SCOPED workflow** | `counseling_requests`, `escalations`, `posts`, `comments`, `post_reactions`, `reports`, `professor_admin_tasks`, `roadmap_revision_requests`, `professor_question_auto_reply_rules`, `academic_terms`, `course_offerings`, `course_weekly_plans` | full CRUD on `roadmap_revision_requests`; rest already revoked | none |
| **USER-SCOPED** | `profiles`, `student_profiles`, `student_courses`, `student_mission_progress`, `student_weekly_progress`, `student_course_progress`, `student_personalized_weekly_roadmaps`, `study_roadmaps`, `study_tasks`, `roadmap_requests`, `roadmap_results`, `chat_sessions`, `chat_messages`, `student_course_schedule_slots`, `student_custom_courses(+slots)`, `user_notifications` | **SELECT+INSERT+UPDATE on `profiles`**; **full CRUD on `student_profiles`, `student_courses`, `student_mission_progress`**; INSERT on `user_notifications`; SELECT grant (RLS-denied) on several others | none |
| **SERVER-ONLY** | 9 curriculum tables, `course_roadmap_personalization_sources`, `student_course_study_guides`, `student_course_records`, `career_track*`, `course_equivalencies`, `curriculum_*` | already revoked | none |
| **NEW (Stage 9)** | `security_events` | n/a | none; `authenticated` SELECT only, tenant-admin scoped |

Post-migration postcondition, asserted inside `20260814010000` and re-verified
live: **`anon` holds no policy and no table privilege anywhere in `public`
except `SELECT` on `schools`.**

## 2. The defect that made the whole model inert

Migration `20260712183855` introduced `profiles.auth_user_id` as the join
between a GoTrue user and an application profile, and `20260712183907` fixed
exactly one policy to use it. Every other authenticated policy kept comparing
`auth.uid()` directly to a column holding `profiles.id`:

```sql
using ((select auth.uid()) = student_id)   -- student_courses
using ((select auth.uid()) = profile_id)   -- student_profiles
using ((select auth.uid()) = id)           -- profiles UPDATE
using ((select auth.uid()) = author_id)    -- course_reviews
where p.profile_id = (select auth.uid())   -- counseling_requests, professor side
```

Live measurement before the fix: 27 profiles, **4** with `id = auth_user_id`,
**19** with no auth user at all; **0 of 3** professors where
`profiles.auth_user_id = professors.profile_id`. So these predicates matched
almost nobody.

The empirical proof is in the probe: before Stage 9, a signed-in student
**could not read their own `student_profiles` row** (`allow:A-reads-own-student-profile`
returned 0 rows). The application never noticed because the same tables carried
`demo anon ... for all` policies and the browser fell through to `anon`.

**This is why the anon policies could not simply be dropped.** `20260814000000`
repairs the identity layer first (`app_private.current_profile_id()` and
friends, SECURITY DEFINER with `search_path = ''`, in a schema PostgREST does
not expose), and only then does `20260814010000` remove the anon surface.

## 3. Authorization matrix (post-Stage-9)

`own` = the caller's own row; `tenant` = same `school_id`; `—` = denied.

| Resource | anon | student | professor | assistant | admin | enforced at |
|---|---|---|---|---|---|---|
| `schools` | R | R | R | R | R | RLS (public by design) |
| `profiles` | — | R tenant / U own `name` | same | same | same | RLS + column grant |
| `student_profiles` | — | CRUD own | — | — | — | RLS |
| `student_courses` | — | CRUD own (course must be in tenant) | — | — | — | RLS + action (`resolveTenantCourse`) |
| `student_mission_progress` | — | CRUD own | — | — | — | RLS |
| `student_weekly_progress` | — | R own | R own offering | — | — | RLS + `app_private.is_professor_of_offering` + column grants (`private_note` not granted) |
| `courses` / `departments` / `course_professors` | — | R tenant | R tenant | R tenant | R tenant | RLS |
| `professors` | — | R tenant | R tenant + U own profile | R tenant | R tenant | RLS |
| `syllabi` | — | R tenant | R tenant | R tenant | R tenant | RLS; write via authorized action + service role |
| `professor_availability` | — | R tenant active | CRUD own | R tenant | R tenant | RLS + `authorizeProfessorScopeWrite` |
| `professor_teaching_slots` | — | R tenant | CRUD own | R tenant | R tenant | RLS |
| `counseling_requests` | — | C own (tenant-clamped), R own, cancel own | R+U own | via action, tenant-scoped | — | RLS + CAS in action |
| `professor_admin_tasks` | — | — | CRUD own | R tenant | R tenant | RLS + action ownership |
| `escalations` | — | R own | R own | R **tenant** | — | RLS; answer via tenant-clamped RPC |
| `faqs` | — | R tenant approved | write via action | write via action | — | RLS (no session-role write) |
| `course_reviews` | — | R tenant, C/U own | same | same | same | RLS |
| `posts`/`comments`/`reactions` | — | R+W own community **and tenant** | same (professor community) | — | — | RLS |
| `user_notifications` | — | R+U own / tenant role broadcast | same | same | same | RLS; **no client-role INSERT at all** |
| `roadmap_revision_requests` | — | R approved | R approved + own | R + staff | R + staff | RLS; all writes service-role after role check |
| `security_events` | — | — | — | — | R own tenant | RLS; no client-role write |
| curriculum family | — | — | — | — | — | no grants, no policies |

## 4. Dangerous patterns — before and after

| Pattern | Where | Verdict |
|---|---|---|
| `using (true)` SELECT to anon on `profiles` | `20260703041159` | **REMOVED** |
| `for update to anon using (identifier <> '' and name <> '')` on `profiles` | `20260703164629` | **REMOVED** — this was AP-1 |
| `for all to anon using (profile_id is not null)` on `student_profiles` | `20260703161724` | **REMOVED** |
| `for all to anon using (student_id is not null)` on `student_courses` | `schema.sql` only, live | **REMOVED** (also closed a live-privilege drift no migration created) |
| `for all to anon, authenticated using (true) with check (true)` on `student_mission_progress` | `20260714204100` | **REMOVED** |
| `for all to anon` on `professor_availability`, `professor_teaching_slots`, `faqs` | various | **REMOVED** |
| `using (is_active)` on `professor_availability` (no tenant/uid term) | `20260703035228` | **REPLACED** with a tenant-scoped policy |
| `using (true)` SELECT on `courses`/`departments`/`professors`/`syllabi`/`course_professors`/`notices` | `20260703035228` | **REPLACED** with tenant-scoped policies |
| `using (true)` SELECT to authenticated on `professor_admin_tasks` | `20260714204203` | **REPLACED** with owner/tenant-staff |
| anon INSERT on `user_notifications` (`title<>'' and body<>'' and target_href<>''`) | `20260703141029`, retained by Stage 8 | **REMOVED** — see §7 |
| anon read/insert/**update** on `roadmap_revision_requests` | `20260703141029` | **REMOVED** |
| `using (role='assistant')` on `escalations`, no tenant term | `20260714134426` | **REPLACED** with a tenant join |
| hardcoded email in a policy predicate | `schema.sql:513` only | already dropped live by `20260812050000`; snapshot is stale |
| `grant all` | — | none found, before or after |

**Legitimately permissive and kept:** `schools` SELECT to anon. A caller must be
able to resolve the tenant registry before it has an identity (SSO slug
resolution, login). It holds a name, a slug and a status.

## 5. Functions / SECURITY DEFINER audit

All nine application functions were reviewed against the **live** definitions.

| Function | Mode | search_path | EXECUTE | Verdict |
|---|---|---|---|---|
| `create_professor_question` (×2 overloads) | DEFINER | `''` | authenticated | **Sound.** Requires `auth.uid()`, role `student`, proves enrolment with `count = 1`, allowlists category/source, bounds the body, and for the tutor branch requires the source message to belong to the caller's own session. |
| `answer_professor_questions` | DEFINER | `''` | authenticated | **Sound — a discovery finding here was wrong.** The report claimed any assistant can answer any tenant's questions, citing `20260714134426`. The live definition is the Stage 6 rewrite (`20260812050000`), whose assistant branch requires `courses.school_id = <staff school>`; an assistant has no `professors` row so the professor branch is NULL for them. **No change made** — changing it would have been churn on a correct policy. |
| `is_professor_of_offering` / `is_student_of_offering` | DEFINER | was `public` | authenticated | **Moved** to `app_private` with `search_path = ''` and dropped from `public`, closing KI-011. Behaviour identical; the three policies that used them were repointed. |
| `approve_course_weekly_plan` | INVOKER | `public` | was `public`-revoked, no grant | **Hardened.** Took `p_professor_id` from the caller and never checked the caller *was* that professor. Now binds them whenever `auth.uid()` exists; the service-role path (the one real caller, which authorizes first) is preserved. Body otherwise byte-identical — it upserts 15 plans and notifies every enrolled student, so a rewrite would have been a functional regression. |
| `replace_student_course_schedule_slots` / `..._custom_...` | INVOKER | `public` | authenticated | **Acceptable.** Existence check only, but INVOKER means the own-row RLS policies gate the DELETE/INSERT. Now stronger than before, because those policies actually resolve. |
| `normalize_professor_question`, `professor_question_fingerprint` | INVOKER, immutable | `''` | revoked | Pure text. Fine. |
| `set_updated_at` | DEFINER trigger | `''` | revoked | Fine. |

No dynamic SQL (`execute format(...)`) anywhere. No function is granted to
`anon`.

## 6. Service-role audit

~60 call sites across 28 modules. The client is server-only (`admin.ts:19`
guards `typeof window`), and the key is never in a `NEXT_PUBLIC_` var.

Most sites *supplement* a real check. The ones that **substituted** authorization
and were fixed this stage:

- `professor.service.ts:189-195` — the globally-first-professor fallback fed a
  service-role read of that professor's counseling caseload. **Fallback deleted.**
- `student-community.actions.ts` `addCourseToSchedule` / `toggleCourseFavorite`
  — service-role INSERT with a caller-supplied `courseId` and no tenant check.
  **Now gated by `resolveTenantCourse`.**
- `course-settings.actions.ts` `getCourseRoadmap` — returned any course's parsed
  syllabus with no session at all. **Now session + tenant gated.**
- `ai-tutor-rag.actions.ts` — enrolment was the entire authorization, with no
  tenant join, so a cross-tenant enrolment became cross-tenant material access.
  **Tenant join added** so the read path no longer depends on the write path.

Recorded, not fixed this stage (bounded impact, no live exploit, see
KNOWN_ISSUES KI-022): `student-weekly-progress.server.ts` `getApprovedCompanyLawContext`
resolves a course by name globally; `weekly-roadmap.server.ts:89` picks an
active term with no `school_id` filter; `curriculum-query.server.ts` has no
`server-only` marker; `course-notices.server.ts` trusts its `studentId`
parameter.

## 7. The anonymous `/support` boundary

**Decision: anonymous support is preserved; the boundary is not.**

Before: `anonymous browser → INSERT into user_notifications` with a
caller-chosen recipient, role, tenant, category and `target_href`. Confirmed
live — an unauthenticated POST delivered a notification to a named recipient.

After:

```
anonymous browser → submitSupportInquiry (validated server action)
                  → createUserNotification (service role)
                  → a row whose every routing field is a constant
```

The caller controls a title (≤120 chars) and a body (≤500 stored, ≤4000
accepted). `recipientRole` is always `admin`, `recipientId` always null,
`category` always `system`, `targetHref` always `/admin`. The tenant is stamped
from the session when there is one and left null when there is not.

No client role holds INSERT on `user_notifications` any more, so this action is
the only way a notification can exist.

Anti-abuse is deliberately bounded to length caps and the fixed routing shape.
Per-IP throttling is **not** added: campus NAT makes an IP a building, not a
caller (the KI-021 reasoning), and an in-memory limiter on serverless resets on
cold start. A real volume control needs a shared store, which this stage does
not introduce.

## 8. Cross-tenant relational consistency

No table uses the `unique (id, school_id)` + composite-FK pattern, so these
remain **structurally possible** at the database level:

- a course in university A linked to a professor in university B
  (`course_professors`, `course_offerings` — plain FKs only);
- a `counseling_request` pairing a student and a professor across tenants
  (blocked by the INSERT policy, not by a constraint; UPDATE has no tenant term);
- a `student_weekly_progress` row pointing at another tenant's offering;
- a `user_notifications.school_id` disagreeing with its recipient.

Stage 9 closes the **reachable** paths in the application and RLS layers (the
enrolment gate, the AI tutor tenant join, the tenant-scoped catalog policies),
and records the structural gap as **KI-022**. Composite foreign keys are the
correct fix and are a schema change with backfill implications across seven
tables — deliberately not attempted in the same stage as an RLS overhaul, with
one live tenant and no staging database to rehearse against.

## 9. Realtime

`user_notifications` is the only table in the `supabase_realtime` publication.
`notification-menu.tsx` subscribes through a bare `createClient(url,
publishableKey)` that never reads the auth cookie, so the socket authenticates
as `anon`. Since Stage 8 removed anon's SELECT policy, **live toasts have not
been delivered**; the bell still fills from the server-rendered list, so the
regression is silent.

Stage 9 does **not** weaken RLS to make this work — that would undo the fix. The
correct repair is client-side (`createBrowserClient` from `@supabase/ssr` plus
`realtime.setAuth(token)`), it changes a user-visible behaviour, and the channel
is off by default (`enableRealtime` defaults false, desktop only). It is
recorded as **KI-022** with the exact fix, and the current state is stated
honestly rather than described as working.

---

## Codex security review round (2026-08-14) — NOT SAFE TO MERGE verdict addressed

Nine findings. **All nine were verified against the branch before any change and
all nine were confirmed** — none needed push-back. Four were materially worse
than reported:

| # | Finding | Verdict |
|---|---|---|
| F1 | Probe cleanup can leak fixtures and Auth users | **CONFIRMED.** 6 of 6 injected provisioning failures leaked (2–5 orphaned rows each). Also found: residue verification never affected the exit code, and a live run had already left 4 posts and 2 course_reviews behind while reporting clean |
| F2 | Foreign-course enrolment is a cross-tenant read primitive | **CONFIRMED and WIDER.** Not one table but five: student_courses, student_mission_progress, study_roadmaps, study_tasks and posts all accepted another tenant's UUID over direct PostgREST |
| F3 | Direct authenticated UPDATE bypasses Stage 5 counseling protections | **CONFIRMED and WORSE.** Beyond the status transition, a professor could reassign the request to ANOTHER TENANT'S student |
| F4 | Roadmap workflow is globally cross-tenant | **CONFIRMED.** The table had no tenant column at all; creation, reads, approval and the overlay were all global. The predicted professor regression was real too |
| F5 | Historically exposed demo credentials unchanged | **CONFIRMED.** Four accounts including professor and admin. **Rotated** — not BLOCKED |
| F6 | Support category and payload insufficiently bounded | **CONFIRMED** |
| F7 | service_role ACLs not guaranteed by migrations | **CONFIRMED.** The privileges existed only as Supabase defaults |
| F8 | Audit attribution can disappear; SSO write is fire-and-forget | **CONFIRMED, and fixing it exposed a second defect I introduced** — the append-only trigger blocked the SET NULL cascade, making profile deletion fail outright |
| F9 | schema.sql represents pre-Stage-9 state | **CONFIRMED** |

Two probe defects had to be fixed before F2 could even be measured honestly:
`rawFetch` dropped per-call headers so a successful INSERT read as "denied", and
requesting a representation made PostgREST re-check the new row against the
SELECT policy — producing 403s that looked like protection but vanish when an
attacker omits the header.
