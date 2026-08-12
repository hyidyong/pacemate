# Current Project State

## Current Stage

Stage 9 / 10
Security / Privacy / Audit / Recovery
Status: IN PROGRESS — work complete on branch `upgrade/stage-9` (2026-08-14),
awaiting PR review/merge. Base: `main` @ `fd44172` (Stage 8 PR #42 merged
2026-08-12, verified). See docs/upgrade/stage-09/HANDOFF.md.

Next stage: Stage 10 — NOT started. Stage 10 begins only after the Stage 9 PR
merges, from the HANDOFF "Stage 10 inputs" section.

## What Stage 9 delivered

The platform's authorization model was a set of `demo anon ... using (true)`
policies from July, because two structural facts made the intended model inert:
the browser holds a Supabase publishable key (so PostgREST is directly
reachable), and a Next.js server action runs before any page guard.

Measured, not asserted: a direct-Data-API probe against two disposable tenants
scored **26 failures out of 67 checks before, 0 after**. Unauthenticated, an
attacker could read every profile, student record, enrolment and syllabus;
rewrite any profile; create a profile with `role=admin`; fabricate or delete
counseling availability; and deliver a notification to any user. Four plaintext
accounts including the administrator shipped in the production client bundle.

Root cause of the whole family: every authenticated RLS policy compared
`auth.uid()` to a column holding `profiles.id`, so the authenticated layer had
never worked and the browser fell through to `anon`. Fixed at the identity layer
first (D-024), then the anon surface removed — `anon` now holds exactly one
privilege in `public`: SELECT on `schools`.

Also delivered: a durable append-oriented audit trail (D-025), the schema-drift
repair that makes the migration chain rebuildable (D-026), tenant suspension
enforced at request time, and a reusable live security probe harness with
deterministic teardown.

## Verified this stage

333 tests / 330 pass / **3 fail — the pre-existing KI-002 trio by name**;
typecheck clean; lint at baseline; build PASS with budgets met and shared JS
unchanged at 102 kB; 0 browser console errors and 0 server errors across
rendered QA of login, dashboard, counseling, notifications, courses and support.

## NOT verified / BLOCKED

- **No verified recovery point of any kind.** PITR off, backup list empty, no
  backup mechanism in the repo. No RPO/RTO is claimed.
- **Full-chain schema rebuild — BLOCKED — NON-PRODUCTION DATABASE REQUIRED.**
  The drift repair is reasoned and unit-guarded, not proven by execution.
- **Realtime notifications are silently non-delivering** since Stage 8 and were
  deliberately not fixed by weakening RLS.
- The audit trail's three application emit paths are code-wired and typechecked
  but were not triggered at runtime this session.
- SSO end-to-end against a real IdP remains BLOCKED (KI-020).

Everything else deferred is in KI-022, with the reason.

## Non-goals (this stage)

- Rate limiting (KI-021 reasoning re-checked and unchanged)
- Composite foreign keys for tenant consistency (schema change across seven
  tables; no rehearsal database)
- `next` patch bump (would make an RLS regression un-attributable)
- Narrowing AI prompt payloads (changes what students are shown)
- Stage 10 CI/CD
- UI/UX changes (Stage 4 preserved — the only visual difference is the QA demo
  panel not rendering without its flag)

## Completion rule

Stage 9 work completes on the branch only; merging requires external review and
human approval. Never merge automatically. Never start Stage 10 automatically.
Repository state is the source of truth.
