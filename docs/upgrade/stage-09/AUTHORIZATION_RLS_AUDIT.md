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

## 7. The `/support` boundary

**Decision (REVISED in review round 3, F8): `/support` requires a session.**

The round-1 decision — "anonymous support is preserved; the boundary is not" —
was **wrong**, and the review round that found it was right. Two halves of the
same feature disagreed: `/support/page.tsx` already gated itself with
`requireRoles`, while `submitSupportInquiry` still accepted a sessionless
submission. And because a sessionless submission had no tenant, it produced a
role broadcast with `school_id = NULL`, which matches **no reader** under the
notification policy. Every anonymous inquiry was accepted, persisted, and then
silently unreadable by any administrator. The feature did not work; it only
looked like it did.

Option A (require login) was chosen from repository evidence rather than
preference: the page already enforced it, and KI-021 already recorded
sessionless submission as a defect.

Before: `anonymous browser → INSERT into user_notifications` with a
caller-chosen recipient, role, tenant, category and `target_href`. Confirmed
live — an unauthenticated POST delivered a notification to a named recipient.

After:

```
signed-in browser → submitSupportInquiry (validated server action)
                    ├─ refuses without a profile AND a school_id
                    → createUserNotification (service role)
                    → a row whose every routing field is a constant,
                      tenant-stamped from the SESSION
```

The caller controls a title (≤120 chars), a body (≤500 stored, ≤4000 accepted)
and an allowlisted category. `recipientRole` is always `admin`, `recipientId`
always null, `category` always `system`, `targetHref` always `/admin`. The
tenant comes from the session and **never** from the form — a submitted
`schoolId` is ignored.

No client role holds INSERT on `user_notifications` any more, so this action is
the only way a notification can exist.

Guarded by `src/services/support-boundary.test.mjs` (13 tests), which asserts
both halves — that the action refuses without a session and that the page still
gates itself — so the two cannot drift apart again.

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

## 9. Realtime — REVISED IN ROUNDS 2 AND 3

`user_notifications` is the only table in the `supabase_realtime` publication.

**Round 1 (the defect).** `notification-menu.tsx` subscribed through a bare
`createClient(url, publishableKey)` that never read the auth cookie, so the
socket authenticated as `anon`. Since Stage 8 removed anon's SELECT policy, live
toasts had not been delivered; the bell still filled from the server-rendered
list, so the regression was silent. Stage 9 declined to weaken RLS for it.

**Round 2.** The client was moved to `createBrowserClient` from `@supabase/ssr`
and given the user JWT via `realtime.setAuth(token)`.

**Round 3 (F11) found that round 2 was not sufficient — two further defects:**

1. **The handshake raced the subscription.** `setAuth()` was fire-and-forget, so
   the socket could open and evaluate RLS as `anon` before the token was
   installed. It authenticated by luck, not by construction.
2. **The subscription filtered on `recipient_id`.** A role broadcast carries a
   NULL recipient, so `recipient_id=eq.<me>` can never match one. Tenant-wide
   announcements were structurally excluded regardless of what RLS permitted —
   a client-side filter silently overriding the policy.

Now: `await supabase.auth.getSession()` → `supabase.realtime.setAuth(token)` →
**then** `.subscribe()`, with an unfiltered
`{ event: "INSERT", schema: "public", table: "user_notifications" }`
subscription and RLS doing the filtering. The client-side recipient check
remains as defence in depth, not as the boundary: it accepts a NULL recipient
(role broadcast), accepts its own id, and ignores anyone else's.

**RLS was not weakened to make delivery work.** `notification-realtime.test.mjs`
asserts that the component references neither `service_role` nor
`SUPABASE_SERVICE_ROLE_KEY`, and pins the ordering of the handshake against the
subscription so the race cannot return.

**Live delivery is UNVERIFIED — it requires a real socket and a real INSERT,
for both a direct notification and a role broadcast.** The channel is off by
default (`enableRealtime` defaults false, desktop only) and the browser preview
was unavailable this session. DEFERRED — Stage 10.

---

## Codex security review round 2 (2026-08-14) — NOT SAFE TO MERGE verdict addressed

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


---

## Codex security review round 3 (2026-08-14) — authorization findings

Round 3 raised twelve findings; four of them (F2, F3, F4, F7) are changes to the
authorization model itself and belong in this document. All four were verified
against the live database before any change, and all four were confirmed.

### F2 / F3 — provenance is immutable, enforced by column privileges

The defect class: an UPDATE policy that only asks *"do you own this row?"*
cannot constrain *"which row is this?"*. A caller who legitimately owns a review
or a post could rewrite the columns that establish where the row belongs and who
wrote it — `course_id`, `author_id`, `school_id`, `community_type`, `board_key`.
Ownership was checked; provenance was not.

**F2 was wider than reported, and the reported test was misleading.** The
report's cross-tenant `course_id` move returned 403, which reads as protection.
It was not: PostgREST was rejecting the row because the SELECT policy could not
see the *post-update* row, not because anything constrained the column. Adding a
same-tenant `courseAlt` fixture as a discriminator settled it — the same-tenant
move succeeded with **204**. `course_id` was entirely unconstrained; the 403 was
an artifact of the reporter's fixture happening to cross a tenant boundary.

This is why the fix is a **column-level UPDATE grant**, not a policy predicate:

```sql
revoke update on public.course_reviews from authenticated, anon;
grant update (difficulty, workload, grading_style, team_project, content,
              updated_at)
  on public.course_reviews to authenticated;
```

The database now refuses the column, so there is no policy expression to reason
about and no visibility side effect to mistake for enforcement. `posts` gets the
same treatment in `20260814120000`, which additionally prevents a client from
authoring into a privileged board:

```sql
-- INSERT policy gains:
and not app_private.is_privileged_board_key(board_key)
```

`course_notice` is trusted content: it renders to students as an official
notice. A student-authored post must not be able to promote itself into it.

The snapshot now records **column privileges**, and
`supabase/security-snapshot.test.mjs` asserts that no client role holds UPDATE
on any provenance column of `posts` or `course_reviews` — so a future migration
that re-grants `UPDATE` table-wide fails a test rather than silently reopening
this.

### F4 — a course-less FAQ is not a global FAQ

The FAQ SELECT policy short-circuited on `course_id IS NULL`, treating "no
course" as "visible to everyone". Tenant scope was derived from the course, so a
row without one had no tenant and leaked across every university.

`20260814130000` resolves the tenant through the course **or**, when there is no
course, through `professors.school_id` — the FAQ's author. The `IS NULL`
short-circuit is gone entirely. Rows that resolve to no tenant by either path
are surfaced by a `raise warning` at migration time rather than being quietly
made global.

Verified live in both directions, which matters more than the deny case alone:
`deny:faq-cross-tenant-courseless` returns 0 rows, and
`allow:faq-own-tenant-courseless` returns 1 — a fix that hides the FAQ from its
own tenant would not be a fix.

### F7 — the append-only audit claim now has an ACL behind it

"No client role can write `security_events`" was true of the **policies** and
unverified of the **privileges**: the table's grants were whatever the platform
defaults happened to be. A policy-only guarantee is not a guarantee, because a
privilege can arrive through PUBLIC or through role inheritance without any
policy changing.

`20260814140000` states them explicitly:

```sql
revoke all on public.security_events
  from public, anon, authenticated, service_role;
grant select          on public.security_events to authenticated;
grant insert, select  on public.security_events to service_role;
```

Note that `service_role` does **not** receive UPDATE or DELETE. Production
append-only behaviour was not weakened for testing convenience: the probe cannot
delete its own audit rows, so its test events remain in the table permanently
and the probe reports them rather than cleaning them up.

The snapshot now computes **effective** privileges with `has_table_privilege`
rather than reading explicit grants only, and asserts separately that nothing at
all is granted to `PUBLIC` — the role every other role inherits from.

### Round-3 live verification

| Probe | Result |
|---|---|
| `rls-probe.mjs` (anon, user A, user B over plain PostgREST, two disposable tenants) | **PASS — 96 checks, 0 failed** |
| `audit-trail-probe.mjs` | **PASS — 12 checks, 0 failed** |
| `verify-notification-rls.mjs` (own fixtures, positive and negative) | **PASS — 6 checks, 0 failed** |
| `dump-security-snapshot.mjs --check` | **PASS — committed snapshot matches the live database** |

Write outcomes are confirmed by a service-role read-back of the persisted row,
with the mutation posted **without** `Prefer: return=representation` — the
weakest attacker path. A response representation is never treated as evidence.


---

## Codex security review round 4 (2026-08-14) — authorization findings

Five of round 4's findings change the authorization model and belong here.

### Finding 1 — notification read state is per recipient

A tenant-wide notification was stored ONCE with `recipient_id = NULL`, and
`is_read` is a column on that row. Every holder of the role shared it, so the
first reader marked it read for the whole cohort. **This was not an RLS bypass**
— the UPDATE policy's USING and WITH CHECK both matched the role branch, so
writing a peer's read state was the designed behaviour. 14 shared rows existed
live; 12 had already been flipped.

Fixed by fan-out at the single creation chokepoint (D-033). `recipient_id` is
NOT NULL as of `20260814150000`, and both policies collapse to:

```sql
using (recipient_id = app_private.current_profile_id())
```

The tenant term went with the role branch. It is subsumed: a notification is
addressed to exactly one profile, and a profile belongs to exactly one tenant.
This policy is strictly NARROWER than what it replaces.

Proven live with a positive sentinel first — peer B must be shown to be
genuinely eligible before "A could not affect B" means anything:

| Check | Before | After |
|---|---|---|
| `peer-b-sees-broadcast` (sentinel) | 1 row, unread | 1 row, unread |
| `broadcast-peer-isolation` | **is_read=true** | is_read=false |
| `mark-all-peer-isolation` | **is_read=true** | is_read=false |

### Finding 2 — course reviews are student experience

`/reviews` was gated by `redirectNonStudent`, and nothing below the route
agreed: the INSERT policy asked "is it yours" and "is it your tenant", both true
for a professor reviewing a colleague's course. A route guard is not an
authorization boundary — a server action runs before any page renders. All three
staff roles posted a same-tenant, self-authored review and got 201 with the row
persisted.

`20260814160000` adds `app_private.current_user_role() = 'student'` to the
INSERT policy, keeping the author and tenant terms, with a postcondition that
fails the migration if any of the three is missing. The server action refuses
independently. INSERT only: once no staff member can create one, every row is
student-authored, and adding a role term to UPDATE would freeze a student's own
past reviews the moment their role changed. **No enrolment requirement was
invented** — no repository evidence requires one, and a test asserts the policy
contains no `student_courses` predicate.

### Finding 3 — the weekly advance is bound to one exact enrollment

`student_courses` is UNIQUE on `(student_id, course_id, STATUS)`, so a student
legitimately has several rows for one course. Authorization inspected one row
(arbitrarily — `.limit(1)` with no ORDER BY) and discarded its primary key; the
compare-and-set then matched `student_id + course_id + current_week` and moved
every row that matched. Feedback was written before the CAS ran, so a losing
caller had already persisted.

`20260814170000` adds `public.advance_student_week(uuid, integer, text)`:
SECURITY DEFINER, `search_path = ''`, bound to `app_private.current_profile_id()`
so a caller-supplied enrollment id is re-checked for ownership and tenancy. One
statement establishes the row, the owner, the tenant and the expected week, and
takes `for update of sc` while that predicate still holds — a second caller
blocks, re-evaluates after the first commits, matches nothing, and returns
`stale`. Feedback is written inside the same transaction, only by the winner.

### Finding 6 — TRUNCATE is not subject to RLS

Confirming that a student cannot delete an official `course_notice` (they
cannot: the DELETE policy binds `author_id`, and round 3's F3 means no student
can author one) surfaced something no policy can help with. `authenticated`
effectively held TRUNCATE on 31 of 54 public tables — the platform default,
never narrowed. TRUNCATE ignores row policies and fires no row triggers, so a
role holding it makes every DELETE policy in this document decorative.

Not reachable through PostgREST, which has no TRUNCATE verb, so this is recorded
as least privilege rather than as an exploit. `20260814180000` revokes TRUNCATE,
REFERENCES and TRIGGER from `anon` and `authenticated` across `public`, sets
default privileges to match, and asserts the Data API verbs the application
needs survived.

### Finding 5 — the anon closure was table-only

`20260814010000` revoked anon's TABLE privileges and asserted that as its
postcondition. FUNCTION privileges were never in scope, so two demo-era RPCs
kept an explicit `anon=X` grant:

```
public.replace_student_course_schedule_slots(uuid, jsonb)
public.replace_student_custom_course_schedule_slots(uuid, jsonb)
```

Both are SECURITY INVOKER, so RLS still applied with anon's now-empty table
privileges and a call would have failed — the reach was bounded by a second
control rather than by the entry point being shut. `20260814190000` revokes it
and sets default privileges so new functions cannot arrive with it.

**The authorization matrix row for `anon` should now be read as: SELECT on
`schools`, and nothing else — no other table privilege, and no function EXECUTE
anywhere in `public` or `app_private`.**

### Round-4 live verification

| Probe | Result |
|---|---|
| `rls-probe.mjs` | **PASS — 108 checks, 0 failed**, residue clean |
| `audit-trail-probe.mjs` | **PASS — 12 checks, 0 failed** |
| `verify-notification-rls.mjs` | **PASS — 10 checks, 0 failed** |
| `dump-security-snapshot.mjs --check` | **PASS — matches the live database** |

One detail worth keeping: the notice-delete checks returned **HTTP 204** while
the row survived. PostgREST reports a zero-row DELETE as success, so the status
code said "deleted". The verdict comes from a service-role read-back, which is
the only reason those checks are meaningful.


---

## Codex security review round 5 (2026-08-14) — authorization findings

**First, a retraction.** The `108 checks, 0 failed` figure recorded in the
round-4 section above is WITHDRAWN. Four of those checks — the anon-read ALLOW
branch — passed a literal `true` and could not fail; one of them recorded PASS
against an HTTP 401. The corrected, freshly-run figure is **115 checks, 0
failed**, and all 115 can fail.

### F1 — Stage 5's booking invariants were not a database boundary

`authenticated` held table INSERT on `counseling_requests`, and the INSERT
policy could only ask two questions: is `student_id` the caller, and is
`professor_id` a professor in the caller's school. Everything Stage 5 actually
enforces lived in `createCounselingRequest()`: the slot must come from
`getAvailableCounselingSlots(tenant)`, which is what makes it canonical, inside
the professor's availability, of that professor's slot length and within the
booking horizon — and `status` is a server constant.

Measured live, all five persisted with HTTP 201: a 10:07 non-slot time, an
eight-hour duration, 03:00 outside availability, a booking 900 days out, and
`status = 'approved'` set by the student.

**A note on the measurement, because the first attempt was wrong.** An earlier
draft reused one base time for every attempt, and the EXCLUDE constraint
`counseling_requests_no_active_overlap` rejected two of them — because they
collided with a row a PREVIOUS attempt in the same loop had just created. Those
two returned 400 and read as "protected" while nothing had authorized anything.
Disjoint days showed all five succeeding. **A denial produced by an unrelated
constraint is not an authorization control**, which is the same trap round 3
caught in F2.

**The boundary moved rather than being duplicated.** Those invariants are not
expressible as an RLS predicate without reimplementing the slot engine in SQL
and keeping two definitions of "a valid slot" in step forever. `20260814200000`
revokes INSERT from `anon` and `authenticated` and drops the now-unreachable
policy; the action performs its INSERT under the service role after its existing
validation. Reads still go through the caller's session, so RLS still decides
what a student sees, and the EXCLUDE constraint still arbitrates concurrency.

### F2 / F3 — a caller-supplied id is not authorization

`removeCourseAssignment` checked `role === "professor"` and then handed the
caller's own `courseId` to a service-role write. `submitRoadmapFeedback`
required a session and checked the course's tenant but never the ROLE, so staff
could file a report stored and displayed as "학생 익명 제보".

Two conditions must BOTH hold before a privileged course write, and neither
implies the other: the course is in the caller's tenant, AND the caller is
assigned to it. Assignment alone is insufficient because `course_professors` has
no composite foreign key, so a cross-tenant assignment row is structurally
creatable (KI-022). One helper now answers both for all three privileged course
actions, and every write uses the VERIFIED id.

### F4 — a recipient may change read state, and nothing else

Round 4 fixed WHOSE notification row is writable. It did not touch WHICH
COLUMNS, and `authenticated` held table-wide UPDATE. Measured: a recipient
rewrote seven of eight columns on their own row — `title`, `body`,
`target_href`, `recipient_role`, `school_id`, `category`, `created_at`.
`target_href` is followed by `markNotificationReadAndGo`, so a recipient could
repoint their own notification anywhere in the app.

`recipient_id` was the one that held, and only incidentally: the policy's WITH
CHECK rejects reassigning the row away from yourself. **A column protected as a
side effect of a row predicate is not a column that is protected.**

`20260814210000` revokes table UPDATE and grants `UPDATE (is_read)`. Column
privileges say WHAT may be written; policies say WHICH ROW. Neither substitutes
for the other, and the snapshot now asserts both.

Sibling audit: of the 25 tables `authenticated` can UPDATE, 11 have no UPDATE
policy at all (inert) and 14 are reachable — every one of them a "users manage
own X" surface the user authors end to end. `user_notifications` was the only
table whose content is server-authored and merely acknowledged.

### Updated authorization matrix rows

| Resource | Change |
|---|---|
| `counseling_requests` | **no client INSERT.** Creation is the server action under the service role, after full Stage 5 validation. Reads and the cancel CAS are unchanged |
| `user_notifications` | `authenticated` UPDATE is **column-scoped to `is_read`**; the row is still bounded by `recipient_id = current_profile_id()` |
| every function | a function created TOMORROW is not anon-executable, enforced by an event trigger rather than by default privileges — see HANDOFF round 5, F9 |

### Round-5 live verification

| Probe | Result |
|---|---|
| `rls-probe.mjs` | **PASS — 115 checks, 0 failed**, residue clean |
| `audit-trail-probe.mjs` | **PASS — 12 checks, 0 failed** |
| `verify-notification-rls.mjs` | **PASS — 12 checks, 0 failed** |
| `dump-security-snapshot.mjs --check` | **PASS — matches the live database** |
