# Stage 9 — Implementation Plan and Prioritisation

## 1. Method

Four read-only discovery agents (auth/IDOR, database/RLS/RPC, privacy/secrets/
audit, recovery/drift) ran in parallel over the merged tree, then the lead
reconciled their registers against **live database evidence** before any change.

Reconciliation mattered. Two discovery claims did not survive:

- **`answer_professor_questions` is not vulnerable.** The report cited the 2026-07-14
  definition; the live function is the Stage 6 rewrite, whose assistant branch
  already requires a tenant match. No change was made.
- **A draft fix would have destroyed `approve_course_weekly_plan`.** Writing a
  "hardened" replacement from the report's summary dropped the 15-week upsert
  and the student notification. Caught by reading the original before replacing
  it; the shipped version keeps the body byte-identical and adds only the
  caller binding.

One finding was reclassified *up*: KI-014 described availability writes as
lacking ownership guards between professors. They were reachable with **no
session at all**, and the database had no backstop.

## 2. Prioritisation

**P0 — active cross-tenant write, privilege escalation, credential exposure**

| ID | Finding | Status |
|---|---|---|
| S9-01 | anon can UPDATE any `profiles` row (`role`, `auth_user_id`) and INSERT a profile with `role=admin` — privilege escalation and account takeover | **CLOSED** |
| S9-02 | anon can read the entire user directory and all student records | **CLOSED** |
| S9-03 | anon can create, flip and delete counseling availability — correctness-critical scheduling data | **CLOSED** |
| S9-04 | anon can rewrite `student_courses` and `student_mission_progress` | **CLOSED** |
| S9-05 | Four plaintext accounts incl. `admin1@` in the production client bundle | **CLOSED** (rotation outstanding — operator action) |
| S9-06 | Server actions execute before page guards; availability, FAQ, revision-approval and syllabus actions had no session check | **CLOSED** |
| S9-07 | `posts.school_id` + 9 columns in no migration — the chain cannot rebuild the database | **CLOSED** (repair applied; end-to-end rebuild BLOCKED) |
| S9-08 | No PITR, no backups, no backup mechanism | **BLOCKED — external.** Documented, verified, runbook written |

**P1 — cross-tenant confidential read, auth bypass, broad public mutation**

| ID | Finding | Status |
|---|---|---|
| S9-09 | Authenticated RLS predicates compared `auth.uid()` to `profiles.id` — inert for nearly every user | **CLOSED** |
| S9-10 | Cross-tenant reads: catalog, professor directory, syllabi, admin tasks, mission progress | **CLOSED** |
| S9-11 | Cross-tenant write of another student's mission progress | **CLOSED** |
| S9-12 | anon notification injection with arbitrary recipient and `target_href` | **CLOSED** |
| S9-13 | anon read/insert/**approve** of curriculum revisions | **CLOSED** |
| S9-14 | Any assistant reads every student question platform-wide (`escalations`) | **CLOSED** |
| S9-15 | Cross-tenant enrolment → AI tutor exfiltrates another university's material | **CLOSED** |
| S9-16 | `getCurrentProfessor` first-row fallback exposes another professor's caseload to every assistant | **CLOSED** |
| S9-17 | Tenant suspension never enforced on the session path | **CLOSED** |
| S9-18 | `approve_course_weekly_plan` trusts a caller-supplied professor id | **CLOSED** |
| S9-19 | No durable audit trail; privileged actions with no record at all | **CLOSED** |
| S9-20 | KI-011: SECURITY DEFINER helpers exposed as public RPC | **CLOSED** |
| S9-21 | `pdf-parse` vendors a 2018 pdf.js, no page cap, no timeout | **DEFERRED — KI-022** |
| S9-22 | No erasure path for any personal data | **DEFERRED — KI-022** |
| S9-23 | Raw `PostgrestError` logged around the most sensitive tables | **PARTIAL** (worst site fixed; rest KI-022) |

**P2/P3** — over-broad AI prompt payloads, unguarded operational scripts,
client-storage bleed, `next` patch bump, remaining service-role substitutions,
Realtime non-delivery. All recorded in KI-022 with file:line.

## 3. What was implemented

**Migrations (5, all applied to live, each with preconditions + postconditions)**

1. `20260814000000_stage9_identity_helpers` — `app_private` schema; SECURITY
   DEFINER helpers with `search_path = ''` resolving through
   `profiles.auth_user_id`; relocates the two offering predicates out of the
   PostgREST-exposed schema (KI-011).
2. `20260814010000_stage9_close_anon_surface` — drops the entire `demo anon`
   policy family, repairs the identity predicates, adds tenant-scoped catalog
   and workflow policies, closes notification INSERT, and finishes with a
   blanket revoke so the anon surface is an explicit one-table allowlist.
3. `20260814020000_stage9_schema_drift_repair` — the ten hand-applied columns,
   idempotently.
4. `20260814030000_stage9_security_events` — the append-oriented audit table.
5. `20260814040000_stage9_rpc_authorization` — binds `approve_course_weekly_plan`
   to its caller.

Plus an additive guard in `20260812070000` so `posts.school_id` exists at its
first point of use — a strict no-op where that migration already ran, and the
only way a fresh chain can rebuild. Recorded as **D-024**.

**Application** — authorization added to the ungated actions; every server-side
use of the anon browser client converted to the session or service-role client;
demo credentials moved server-only behind an environment gate; professor
fallback deleted; tenant suspension enforced; AI tutor tenant join; enrolment
tenant gate; the last unbounded OpenAI call bounded; durable audit wired into
three privileged paths; `/support` reshaped to a constant-routing boundary.

**Test infrastructure** — `scripts/security/rls-probe.mjs` (67 live checks, two
disposable tenants, deterministic teardown), `probe-guard.mjs` + 9 unit tests,
`stage9_rls.test.mjs` (10 migration guards).

## 4. Ordering constraint that shaped the whole stage

The anon policies could not be dropped first. They were load-bearing precisely
*because* the authenticated policies were dead — the browser fell through to
`anon` and the app worked. Removing them before repairing the identity layer
would have produced a platform where nobody could read their own data.

So: identity helpers → verify → close anon → convert the application's
anon-client call sites in the same commit range → re-probe. The probe's nine
**allow** checks exist for exactly this reason, and one of them
(`A reads own student profile`) was *failing before the fix* — proof the
authenticated layer had never worked.

## 5. Explicitly not done

- **Composite foreign keys for tenant consistency.** The correct fix for the
  structural gap, but a seven-table schema change with backfill implications, in
  the same stage as an RLS overhaul, with one live tenant and no rehearsal
  database. KI-022.
- **Rate limiting.** KI-021's reasoning is unchanged and was re-checked: the
  concrete abuse vectors were authorization holes, now closed; per-IP is wrong
  behind campus NAT; an in-memory limiter on serverless is per-instance theatre.
- **`next` 15.5.20 → 15.5.21.** A framework bump during an RLS overhaul makes
  any regression un-attributable. First Stage 10 action.
- **Realtime repair.** Fixing it is a client change to a user-visible behaviour
  that is off by default; weakening RLS to accommodate it was rejected outright.
- **Narrowing the AI prompt payloads.** Changes what the model receives and
  therefore what students read — product behaviour, not a security boundary.
