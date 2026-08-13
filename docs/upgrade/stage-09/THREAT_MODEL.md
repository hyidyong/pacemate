# Stage 9 — Threat Model

Scope: the merged platform at `main` @ `fd44172` (Stage 8). Written before the
hardening work, revised with what the probes actually found.

## 1. The one structural fact that shapes everything

**The browser holds a Supabase publishable key and can talk to PostgREST
directly.** `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` is in the client bundle by
design — it is a public identifier, not a secret. It means every table the
`anon` role can reach is reachable by `curl` from anywhere, with no session, no
UI, and no server action involved.

Consequently the application server is **not** a boundary for anything the
database exposes. Before Stage 9 the platform's authorization model was
effectively:

```
browser ──(publishable key)──> PostgREST ──> `demo anon ... using (true)` ──> data
```

and the Next server sat beside that path, not in front of it.

**Second structural fact:** a Next.js server action is a `POST` to a route with
a `Next-Action` header, and the action body runs *before* any page renders. The
page-level `requireRoles(...)` guards therefore never protected any action. The
action ids are in `/_next/static/chunks/**`, which is served without auth.

Together these two facts mean "the UI does not show it" and "the page redirects
you" were both load-bearing in places where only a real check would do.

## 2. Actors and capabilities

| Actor | Realistic capability |
|---|---|
| Anonymous internet user | Has the publishable key (read it from the bundle). Can issue arbitrary PostgREST requests and arbitrary server-action POSTs. Can enumerate ids returned by any readable table. |
| Authenticated student | Everything above, plus a real GoTrue JWT and an 8h HMAC app cookie. Knows their own ids; can learn others' from any readable table. |
| Professor | As above, plus write access to their own courses, availability, plans, and their students' counseling requests. |
| Assistant | As above, tenant-wide staff reach over counseling and the question workflow. Notably has **no** `professors` row, which several code paths did not anticipate. |
| Tenant administrator | Broadcast to every profile in the tenant; approve curriculum revisions that publish into every student's roadmap. |
| Platform operator | Holds `SUPABASE_SERVICE_ROLE_KEY` and the Supabase/Vercel dashboards. No platform-level in-app identity exists — correctly, there is no "superadmin" role in `user_role`. |
| Compromised authenticated account | An attacker with a valid session. The app session is irrevocable for up to 8h (no server-side store), so containment is slower than revocation would suggest. |
| Malicious user of another university | The multi-tenant adversary. Only one tenant exists live, so every cross-tenant claim in this stage was tested against **provisioned probe tenants**, not asserted. |

## 3. Assets, ranked by what losing them costs

1. **Identity and privilege** — `profiles.role`, `profiles.auth_user_id`,
   `profiles.school_id`. Whoever can write these owns every other control.
2. **Counseling content** — `counseling_requests.topic`, `professor_note`.
   Personal, sometimes sensitive, and the product's core workflow.
3. **Scheduling availability** — `professor_availability`. CLAUDE.md names this
   correctness-critical; it is also an availability weapon (close every window
   and counseling stops platform-wide).
4. **Student learning records** — `student_weekly_progress.private_note`,
   `student_mission_progress.actual_progress_feedback`, `student_profiles`
   (career goals, self-declared weaknesses, free-text transcript).
5. **Course material** — `syllabi.raw_extracted_text`, weekly plans. Tenant
   assets, and the grounding corpus the AI tutor cites.
6. **Notifications** — a first-party channel into every user's UI, with a
   clickable `target_href`.
7. **Secrets** — service-role key, `PACEMATE_SESSION_SECRET`, OpenAI key.
8. **Audit history** — did not exist durably before this stage.

## 4. Trust boundaries

| Boundary | Pre-Stage-9 state |
|---|---|
| browser → Next server | Real, but bypassable: actions ran without the page guards. |
| browser → Supabase Data API | **Effectively absent.** `anon` could read 7 tables in full and write 6. |
| server action → Supabase | Mixed: some actions used the *anon browser client* server-side. |
| RLS | Present but largely inert: most `authenticated` predicates compared `auth.uid()` to `profiles.id` and matched nobody. |
| SECURITY DEFINER RPC | Sound (Stage 6 hardened them); two helpers were needlessly exposed as public RPC endpoints. |
| service-role client | Widely used; mostly after a real check, with a handful of substitutions. |
| SSO provider → callback | Sound (Stage 7), re-verified. |
| `/support` | *Then:* an unauthenticated INSERT into a general-purpose notification table. *Now (round 3, F8):* a session is required; the page and the action no longer disagree, and the submission is tenant-stamped from the session so an admin can actually read it. |
| Realtime | *Then:* subscribes as `anon`; Stage 8's fix silently stopped delivery. *Now (round 3, F11):* the socket is authenticated **before** it subscribes, and the subscription no longer filters on `recipient_id` — which had structurally excluded every role broadcast. Live delivery UNVERIFIED. |
| operational scripts | Two service-role scripts with no guard at all. |

## 5. Prioritised attack paths (what an attacker would actually do)

**AP-1 — Own the platform from a terminal, no account.**
Read the publishable key from the bundle → `PATCH /rest/v1/profiles?id=eq.<any>`
setting `role` or `auth_user_id`. The policy predicate was
`identifier <> '' and name <> ''`. This is privilege escalation and account
takeover in one request. *Confirmed live (a probe profile was rewritten by an
unauthenticated PATCH; an anonymous POST created a profile with `role=admin`,
HTTP 201).*

**AP-2 — Harvest the university.**
`GET /rest/v1/profiles?select=*` → 27 rows with names, login emails, roles and
tenant. Join `student_profiles` (career goals, weaknesses) and `student_courses`
(timetables). *Confirmed live.*

**AP-3 — Switch counseling off.**
`GET professor_availability` to enumerate ids → `PATCH is_active=false` on all
of them; or `POST` fabricated windows. Also reachable through two server actions
that took `professorId` from the form with no session at all.
*Confirmed live (both the toggle and the insert).*

**AP-4 — Publish curriculum content to every student.**
`updateRoadmapRevisionStatus` had no role check, and the anon policy allowed the
`approved` transition, so an unauthenticated POST could approve any revision —
whose `proposed_patch` is merged into the rendered roadmap. Compounded by an
anon INSERT that could create the revision in the first place.

**AP-5 — Phish inside the product.**
`POST /rest/v1/user_notifications` with any `recipient_id` and any
`target_href`, unauthenticated. It renders as a first-party notice.
*Confirmed live.*

**AP-6 — Read another university's material through the AI tutor.**
Enrol in a foreign course (`addCourseToSchedule` never checked the tenant, and
wrote with the service role), then ask the tutor about it: its syllabus, weekly
plans, notices and FAQs are loaded into the prompt and returned with citations.

**AP-7 — Poison the tutor's grounding corpus.**
`addProfessorFaq` had no session check and wrote `approved_at` immediately, and
approved FAQs are retrieved as "교수 공식 Q&A" evidence for other students.

**AP-8 — Sign in as the administrator.**
`curl .../_next/static/chunks/app/login/page-*.js | grep pacemate.edu` returned
four accounts with plaintext passwords, including `admin1@pacemate.edu`.

**AP-9 — Read the whole platform as an assistant.**
Every assistant fell through `getCurrentProfessor`'s "first professor in the
table" fallback and was shown that professor's counseling caseload, with student
names and identifiers, across tenants.

## 6. Deliberately out of scope

- Denial of service by volume, and rate limiting generally (KI-021 reasoning
  still holds: the concrete abuse vectors were authorization holes, per-IP is
  wrong behind campus NAT, and an in-memory limiter on serverless is theatre).
- Attacks requiring the service-role key or the Supabase/Vercel dashboard —
  those are credential-compromise scenarios, covered by RECOVERY_RUNBOOK.md §3.
- Physical and social-engineering attacks.
- Supply-chain compromise of npm packages beyond the dependency review.

## 7. The model Stage 9 implements

```
trusted identity            GoTrue JWT, verified; profiles.auth_user_id is the join
  ↓
tenant membership           profiles.school_id, via app_private.current_school_id()
  ↓
role / authorization        checked in the server action, not the page
  ↓
server/domain validation    ownership and legal state re-derived, never accepted
  ↓
database / RLS              the same rule again, at the boundary an attacker
                            actually reaches
  ↓
auditable result            public.security_events for privileged actions
```

Frontend visibility is never a boundary. Neither is a page guard.

---

## Codex security review round (2026-08-14) — NOT SAFE TO MERGE verdict addressed

Nine findings. **All nine were verified against the branch before any change and
all nine were confirmed** — none needed push-back. Four were materially worse
than reported. (This is review round 2; round 3 follows at the end of this
document.)

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

## Review round 3 (2026-08-14) — what the threat model got wrong

Twelve findings, all confirmed. Three of them change how this document should be
read, because each is a *class* of assumption that was wrong rather than a
single hole.

### The trust boundary this document forgot: the harness itself

Every "confirmed live" claim above rests on `scripts/security/rls-probe.mjs`.
Round 3's F1 found that the probe was not a trustworthy instrument: unbounded
transport (a stalled response body could hang a run indefinitely), no signal
handling (Ctrl-C abandoned provisioned fixtures and Auth users), an Auth listing
capped at a single page (so residue beyond it read as "clean"), and a host guard
that a lookalike domain such as `<ref>.supabase.co.attacker.example` could
satisfy — which would have sent a service-role key to an attacker-controlled
host.

**A measuring instrument is part of the attack surface.** It holds the most
privileged credential in the system and it decides what counts as safe. F1 was
fixed and independently verified *before* any further destructive live probe was
run, and the "what makes a PASS trustworthy" table in SECURITY_TEST_MATRIX.md is
now part of the security evidence rather than an appendix to it.

### Ownership is not provenance

The model above reasons in terms of *who owns a row*. F2 and F3 showed that is
only half of an authorization question. A caller who legitimately owns a review
or a post could still rewrite the columns that establish **where the row belongs
and who wrote it** — `course_id`, `author_id`, `school_id`, `community_type`,
`board_key` — because an UPDATE policy that asks "do you own this?" cannot
constrain "which row is this?".

The consequence is a content-integrity attack, not a data-theft one: a
student-authored post could promote itself into `course_notice`, which renders
to students as official course communication. Provenance is now immutable
through **column-level UPDATE grants**, so the database refuses the column
rather than a policy having to reason about it.

Note also how F2's real severity was nearly missed. The reported exploit
returned 403, which looks like protection; it was PostgREST re-checking the
post-update row against the SELECT policy. A same-tenant control fixture showed
the same move succeeding with 204. **A denial produced by a visibility side
effect is not an authorization control**, and this document should not treat one
as evidence.

### A race is an authorization bug when the loser has effects

F5 and F6 were both lost-update races, and both were treated as security
findings rather than concurrency polish, because in each case the *losing*
caller still produced an external effect: two admins deciding a roadmap revision
at once both succeeded and both fanned out a student-facing notification; a
racing progress submission still paid for an AI generation. An operation that
cannot establish it won must not act as though it did. Both are now
compare-and-set, and only the winner has effects.

### Regressions are findings

F8–F11 were four places where an earlier Stage 9 fix had broken behaviour that
was previously correct: `/support` accepted submissions nobody could read, the
assistant professor workspace lost its data, a roadmap publication notification
lost its tenant, and the Realtime channel excluded role broadcasts. A security
change that quietly disables a feature is a defect of the same seriousness as
the hole it closed — it is simply one whose victim is a legitimate user. Each
was fixed by **restoring the property through the correct mechanism** (tenant
scope, session tenant, RLS-side filtering), never by relaxing the control that
caused it.
