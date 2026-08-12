# Stage 6 — Multi-Tenancy Design

Date: 2026-08-12. Inputs: TENANT_DATA_AUDIT.md (four-agent discovery + live
DB introspection). This document is decided BEFORE any schema/application
migration (spec §24).

## 0. Scope discipline

Stage 6 introduces tenant isolation as a security boundary enforced at
authoritative boundaries. It does NOT: implement SSO (Stage 7), overhaul the
known-broken anon/pre-mapping RLS family (Stage 9, KI-007/011/014), redesign
around subdomains/branding (spec §20), build a university CMS, or add tenant
switching UI. It preserves every prior-stage invariant (Stage 2 canonical
availability, Stage 3 perf, Stage 4 UI, Stage 5 concurrency).

The governing reality (audit §7.5): the public publishable key + wide-open
`anon` demo policies mean a determined attacker can still hit several
demo-era tables directly via PostgREST until Stage 9. Stage 6 therefore makes
the **trusted server boundary** the primary, fully-enforced tenant boundary,
hardens the DB layer wherever that does not break an anon-dependent path, and
documents the residual precisely. This is the same "don't churn the
known-wrong family twice" discipline as D-014.

## 1. Tenant definition

The tenant IS the existing `public.schools` row. `tenant_id ≡ school_id`
(uuid). No parallel `tenants`/`universities` table — the FK graph already
converges on `schools`, and one live school (계명대학교,
`862b661c-810a-4440-ba76-722b2fcf8d6a`) is the default/existing tenant.

The tenant identifier used for authorization is the immutable internal
`schools.id` (uuid) — never `schools.name` (a display string) and never any
client-supplied value (spec §6). Minimal fields added, each justified:

- `schools.status text NOT NULL DEFAULT 'active'` (CHECK in
  `active | suspended`) — present justification: tenant resolution must be
  able to deny a suspended tenant. Enforced in `resolveTenantContext`.
- `schools.slug text UNIQUE` (nullable) — Stage 7 justification: a stable,
  URL/SSO-safe key for future host/IdP→tenant mapping. NOT used for
  authorization in Stage 6; documented as a Stage 7 integration point.

No other school fields (no branding, no config blob) — that would be the CMS
the spec forbids.

## 2. Global vs tenant-scoped resources (summary; full table in AUDIT §2)

- Platform-global: NONE legitimately today. The two accidental global
  namespaces (academic_terms NULL-school "global term"; course_equivalencies
  zero-UUID bucket) are documented risks, not endorsed platform data — 0
  affected live rows, left as-is with a KNOWN_ISSUES note.
- User-global: profiles (identity half), student_profiles,
  student_custom_courses (+slots), roadmap_requests/results (legacy).
- Tenant-scoped, DERIVED (no own column): everything reachable by an
  immutable NOT NULL FK chain to schools — the offering/course subtree, the
  professor subtree, the curriculum subtree, community children. (AUDIT §2.)
- Tenant-scoped, needs OWN column (no usable chain): `user_notifications`
  (broadcast rows have no parent). `professors` (chain broken by nullable
  `department_id`).

## 3. User / membership model — two designs evaluated (spec §7)

### Design 1 (CHOSEN) — single-tenant membership on `profiles`

`profiles.school_id` (made NOT NULL after backfill) is the authoritative
membership. One user belongs to exactly one tenant, in one role
(`profiles.role`). Tenant of any actor = `profile.school_id`.

Pros: matches 100% of live data and the demo-auth model (each account maps to
one school); zero new join tables; the smallest robust design (spec §24);
`profiles.school_id` already has an index (`profiles_school_id_idx`) and a FK.

Cons: cannot express one human affiliated with two universities, or two
roles. Not needed by any current requirement.

### Design 2 (DEFERRED to Stage 7) — `tenant_memberships` join

`tenant_memberships(id, profile_id, school_id, role, status)` with
`unique(profile_id, school_id)`. One identity → many memberships → tenant+role.

Pros: models SSO multi-affiliation and role-per-tenant. Cons: over-engineered
for Stage 6 (spec §7 "do not over-engineer hypothetical features"); every
authorization site would need to choose a membership.

### Decision and the forward path

Design 1 now. The single guard against a costly future rewrite is that ALL
tenant resolution funnels through one server helper `resolveTenantContext()`
(§5). Migrating to Design 2 later is then localized: create
`tenant_memberships`, backfill one row per profile from `profiles.school_id`,
and change the resolver to select the active membership — no call-site churn.
This satisfies spec §7 ("avoid a design that makes future SSO impossible
without major rewrites") without paying for it now. Documented as the primary
Stage 7 integration point.

## 4. Role model and authorization scope (spec §8)

Roles (unchanged): `student | professor | assistant | admin`
(`profiles.role`). All four are TENANT-LEVEL — each acts only within its own
`profile.school_id`. No platform super-admin is introduced: there is no
operational cross-tenant role in the product, and inventing one would create
the exact cross-tenant surface Stage 6 exists to close (spec §8 "do not
invent a platform super-admin unless there is an actual operational need").

| Role | May access | Operations | Tenant scope established by |
|---|---|---|---|
| student | own tenant | book/cancel own counseling, read own tenant's professors/courses/community, own learning data | `profile.school_id` |
| professor | own tenant | manage own counseling requests, own availability, own courses/questions | `profile.school_id` + own professor row |
| assistant | own tenant | professor-workspace ops for their tenant, answer their tenant's questions | `profile.school_id` |
| admin | own tenant | broadcast to their tenant, approve their tenant's revisions | `profile.school_id` |

Client-submitted role or school_id NEVER grants access (spec §8): role comes
from the HMAC-signed session cross-checked against the DB row; tenant comes
from the server-resolved `profile.school_id`.

## 5. Tenant resolution (spec §9) — the single authoritative chokepoint

New helper `resolveTenantContext(profile)` in
`src/services/tenant-context.server.ts`:

```
resolveTenantContext(profile: DemoProfile | null):
  → { tenantId }        when profile has a school_id and the school is active
  → throws TenantResolutionError otherwise (fail closed)
```

- Input is the SERVER-verified profile (from `getDemoProfile()` /
  `resolveAuthenticatedProfile()`), whose `school_id` is loaded from the DB —
  never from `?tenant_id`, request body, localStorage, or a hidden field.
- A client MAY still pass a school_id-shaped value in a form; authorization
  ignores it. The resolver's output is the only tenant used downstream.
- A suspended school (status ≠ 'active') resolves to a denial.
- Because `profile.school_id` becomes NOT NULL (§6), the "no tenant" branch is
  reachable only for a malformed/legacy session → deny.

This is the one place Design 1→2 (§3) would change. Every tenant-scoped query
derives its filter from `resolveTenantContext`, not from ad-hoc reads.

## 6. Database strategy (spec §11) — derivation-first

Prefer deriving tenancy through immutable NOT NULL FKs; add a column only
where the chain is broken. Concretely:

### 6.1 Columns added

- `schools.status`, `schools.slug` (§1).
- `professors.school_id uuid REFERENCES schools(id)` — the counseling
  domain's tenant anchor. The `professors → departments → schools` chain is
  broken by nullable `professors.department_id`; denormalize instead of
  relying on the join (Agent C's landmine). Backfilled from the department
  join (all 3 live professors resolve cleanly), then NOT NULL.
- `user_notifications.school_id uuid REFERENCES schools(id)` — broadcast rows
  (recipient_id NULL) have no derivable parent. Backfilled (§8). IMPLEMENTATION
  NOTE: kept NULLABLE, not NOT NULL — see D-018 (ungated writers can run with a
  null acting profile; NOT NULL would break their degraded notifications).
  The service stamps it best-effort.

### 6.2 Columns tightened (already fully populated live)

- `courses.school_id` → NOT NULL (all 9 live rows already set) — closes the
  `unique(school_id, code)` NULL-leak.
- `profiles.school_id` → NOT NULL after backfill (§8).

### 6.3 Derivation-only (no column added)

counseling_requests, professor_availability, professor_teaching_slots,
professor_admin_tasks (→ professors.school_id); the offering/course/curriculum
subtrees; posts.school_id already exists (stamped from session, §7). This
keeps the schema minimal and avoids the multi-column-tenant integrity traps.

### 6.4 Indexes

- `professors(school_id)` — supports the tenant-scoped professor directory /
  availability joins (new high-frequency filter).
- `user_notifications(school_id, recipient_role)` — supports tenant-scoped
  broadcast reads.
- Existing `profiles_school_id_idx`, `courses(school_id,code)` suffice for
  the rest. No blanket indexing (spec §29).

### 6.5 Tenant-aware uniqueness (spec §17) — deliberate, not mechanical

- `profiles.identifier` stays GLOBALLY UNIQUE for Stage 6. Rationale (AUDIT
  §3): identifier is an email-shaped login handle; login resolves by
  identifier with NO tenant predicate; making it `unique(school_id,
  identifier)` requires tenant-qualified login UX, which is Stage 7 (SSO)
  territory. No signup path exists (demo auth only), so a same-identifier
  collision across tenants cannot occur in Stage 6. This is the single
  biggest uniqueness decision and it is documented as the Stage 7 breaking
  point.
- `courses(school_id, code)`, `departments(school_id, name)` — already
  tenant-aware; the courses one becomes correct once school_id is NOT NULL.
- `counseling_requests` uniqueness/GiST — professor-keyed, inherently
  tenant-local (§9). Untouched.
- No other uniqueness constraint is changed (spec §17: do NOT mechanically
  modify all uniqueness constraints).

## 7. RLS / authorization strategy (spec §13)

Two-layer, honest about the anon reality:

### 7.1 Primary layer — trusted server boundary (fully enforced)

Every tenant-scoped read/write the app issues derives its tenant filter from
`resolveTenantContext`. Concretely (maps to X-items in AUDIT §8):

- Counseling booking (X1): before the INSERT in `createCounselingRequest`,
  assert the selected professor's `school_id === tenantId`; deny with the
  existing SLOT_NOT_AVAILABLE vocabulary otherwise. Both entry points
  (`createCounselingRequest`, `reserveSuggestedCounseling`) funnel through
  this one check. The tenant check runs BEFORE the D-013 self-match so a
  legacy cross-tenant active row is not re-acknowledged as success (AUDIT §4).
- Professor directory / availability / teaching / admin-task feeds (X2, X11):
  scope by tenant professor ids. The availability/busy/teaching/admin-task
  reads all filter to the tenant's professors; the busy feed keeps its D-011
  admin-client authority and minimal projection — tenant filtering there is
  perf/minimization, explicitly NOT the isolation control (the domain engine
  already ignores foreign professors; AUDIT §4).
- Course-mode list (X3): the `course_professors` fallback that returned ALL
  rows when the student has no courses is tenant-scoped.
- updateCounselingStatus / updateCounselingDetails (X4): add
  `.eq("professor_id", callerProfessorId)` to the SAME single CAS UPDATE
  (preserves D-012 exactly — a foreign target becomes a zero-row PGRST116 →
  existing "이미 처리된" conflict path). This closes a cross-tenant WRITE that
  Stage 5 deferred as a same-tenant defect; the risk class changed, so
  Stage 6 owns it.
- Notification fan-out (X5): stamp `school_id` from the resolved tenant;
  broadcasts read within tenant.
- Community post (X9): stamp `posts.school_id` from `resolveTenantContext`,
  never the client form field; remove `ensureProfileSchool`'s auto-assign.
- Reports/reviews/board/catalog reads (X7, X8, X10, X14): tenant-scope at the
  service/server boundary.
- getCurrentProfessor fallback (X12): scope the fallback to the caller's
  tenant / fail closed instead of returning the globally-first professor.

### 7.2 Secondary layer — DB backstop where safe

- counseling_requests INSERT policy `users create counseling requests`
  (authenticated, auth.uid()-based, D-011 era — NOT an anon path): add a
  WITH CHECK subclause asserting the student's school matches the
  professor's school. This makes the booking tenant boundary hold even
  against a crafted direct authenticated PostgREST insert. It does not touch
  the GiST constraint.
- New `school_id` columns (professors, user_notifications) get tenant-aware
  SELECT policies consistent with the existing model where they don't
  conflict with a load-bearing anon read. `user_notifications` anon SELECT
  stays (header reads run as anon in demo-cookie-only state) — documented
  residual; the app-issued reads are tenant-scoped in code.
- RPC `answer_professor_questions` (X6): add a tenant predicate so an
  assistant can only answer questions within their own school (the
  `v_staff_role='assistant'` branch currently bypasses ownership entirely).
  SECURITY DEFINER, so this is a trusted server-side check.

### 7.3 Narrowly-safe dead-exposure removal

- Drop the `demo anon update counseling requests` policy gated on the
  hardcoded `zivilprozess_park@kmu.ac.kr` email (no app path uses it; AUDIT
  §6.4). Revoke the residual anon UPDATE grant on counseling_requests.

### 7.4 Explicitly deferred to Stage 9 (documented, not touched)

The anon `using(true)`-class family on profiles/student_*/counseling
SELECT/user_notifications/mission_progress/etc., and the KI-007 pre-mapping
authenticated policies. Per D-014 discipline, Stage 6 does not patch one
policy into a known-wrong family twice. KNOWN_ISSUES records exactly which
direct-PostgREST anon vectors remain until the Stage 9 overhaul.

## 8. Existing-data migration (spec §16) — safe, staged

Order (details + validation queries in MIGRATION_PLAN.md):

1. Repair remote migration history for `20260812000000` (applied via SQL
   editor, missing from `supabase_migrations`) BEFORE any `db push`.
2. `schools`: add `status` (default 'active'), `slug` (nullable).
3. `professors`: add nullable `school_id`; backfill from
   `departments.school_id` via `department_id`; validate zero remaining NULL
   (all 3 live rows resolve); then NOT NULL.
4. `user_notifications`: add nullable `school_id`; backfill — recipient rows
   from `recipient_id → profiles.school_id`; broadcast rows (recipient_id
   NULL) to the default tenant (only one exists); validate; then NOT NULL.
5. `profiles`: backfill NULL `school_id` to the default tenant (the 9+ NULL
   accounts predate the auto-assign path); validate; then NOT NULL.
6. `courses`: validate zero NULL school_id (already true); then NOT NULL.
7. RLS/RPC changes (§7) as a final migration after columns exist.

Every step: precondition, backfill, validation query (must return 0
offending rows before the constraint is added), rollback note, postcondition.
No data is dropped or silently reassigned; the single existing tenant absorbs
all legacy rows (spec §16 "create default/existing university tenant").

## 9. Stage 5 constraint adaptations (spec §12) — NONE

`counseling_requests_no_active_overlap` (EXCLUDE USING gist, professor_id
WITH =, tstzrange &&) and the redundant `counseling_requests_confirmed_slot_idx`
are professor-keyed. professor_id (uuid PK) is globally unique, so both are
inherently tenant-local: a University A booking can never conflict with a
University B slot, and adding a tenant column to the exclusion key would
WEAKEN it (NULL/differing tenant exempts the pair → double-booking). Verified
against the live constraint definition and Agent C's analysis. The constraint
stays byte-identical. A regression test pins that the booking tenant check
does not perturb same-tenant overbooking prevention (spec §12).

## 10. Cache / client isolation (spec §18, §19)

- No server-side cross-request cache exists (D-007 confirmed) → no tenant
  cache-key work needed server-side; documented so any future
  `unstable_cache` carries a tenant dimension.
- Client state (X13): key `pacemate_student_todos`,
  `pacemate_student_todo_done`, `pacemate.dismissed-course-notices.v1` by
  profile id; clear PaceMate client state (localStorage keys + the Zustand
  chat store) on logout so a shared device does not bleed one
  account's/tenant's data into the next.
- Delete `generateStaticParams` on `/roadmap/[courseId]` (X15) —
  personalized route must never prerender.
- Realtime (AUDIT §7.4): the notification channel filter is client-side over
  an anon policy; its full fix is Stage 9. Stage 6 scopes the app-issued
  notification reads/writes and adds the tenant column; the residual
  direct-socket vector is documented.

## 11. Future Stage 7 SSO compatibility (spec §32)

The model maps cleanly to `authenticated identity → membership → tenant →
role`:

- `profiles.auth_user_id` is the identity seam (already unique-per-auth-user).
- `resolveTenantContext` is the membership→tenant chokepoint (swap Design 1→2
  here for multi-affiliation).
- `schools.slug` is the reserved host/IdP→tenant key.
- Real external requirements for Stage 7 (institution IdP metadata,
  SAML/OIDC endpoints, domain→tenant mapping, JIT provisioning rules) are
  enumerated in HANDOFF.

## 12. Risks

- R1: The anon-role residual (AUDIT §7.5) means the DB layer is not a
  complete boundary for demo-era tables until Stage 9. Mitigation: server
  boundary is fully enforced + counseling INSERT has a DB backstop;
  residual documented per-table. This is the honest headline risk.
- R2: Backfilling all NULL-school profiles to the single tenant is correct
  only because exactly one tenant exists. Guarded by a precondition asserting
  `(select count(*) from schools) = 1` before the profile backfill.
- R3: profiles.school_id becoming NOT NULL could break a session for an
  account the backfill missed. Mitigation: backfill covers ALL NULLs
  (validation query), and `resolveTenantContext` fails closed rather than
  defaulting.
- R4: identifier staying globally unique defers a real multi-tenant signup
  constraint to Stage 7. Acceptable: no signup exists; documented.

## 13. Explicitly deferred work

- Stage 7: SSO, tenant-qualified identifier uniqueness, tenant_memberships
  join, host/slug tenant resolution, storage path tenant-prefixing.
- Stage 8: cache/query tenant dimension if cross-request caching is added;
  academic_terms global-term and course_equivalencies zero-UUID namespace
  cleanup; storage bucket path-scoping.
- Stage 9: the anon/pre-mapping RLS overhaul (KI-007/011/014), the full
  notification/realtime RLS lockdown, professor report RLS defense-in-depth.

## Appendix A — service-role call-site tenant status (from Agent B)

38 `createSupabaseAdminClient()` sites. Six carry no caller-derived
predicate (busy feed ×2 [D-011, deliberate], updateCounselingDetails
[fixed §7.1], curriculum draft ×2, company-law context); three take an
unvalidated identity parameter (course-notices/weekly-progress studentId,
getCurrentProfessor fallback [fixed §7.1]). The remainder carry
student_id/professor_id ownership predicates that are tenant-safe once the
professor/booking boundary (§7) holds. Full register in the discovery
transcript; the Stage 6 edits touch only the counseling/professor-directory/
notification/community sites listed in §7.1.
