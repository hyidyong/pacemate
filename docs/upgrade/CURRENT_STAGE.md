# Current Project State

## Current Stage

Stage 9 / 10
Security / Privacy / Audit / Recovery
Status: IN PROGRESS on branch `upgrade/stage-9`, revised through **four**
external Codex security review rounds (2026-08-14), each of which returned
**NOT SAFE TO MERGE**. Round 4 raised nine substantive findings; every one was
verified against the code, the migrations and live metadata before any change,
and every one was confirmed. All are closed. Awaiting external review.
Base: `main` @ `fd44172` (Stage 8 PR #42 merged 2026-08-12, verified).
See docs/upgrade/stage-09/HANDOFF.md — read its **round-4** section first, as it
corrects claims made in rounds 1–3.

**The next action is another independent Codex security review.**

Next stage: Stage 10 — NOT started. Stage 10 begins only after the Stage 9 PR
merges, from the HANDOFF "Stage 10 inputs" section.

Status markers in Stage 9 documents mean exactly one of: `PASS` (with evidence),
`UNVERIFIED — <exact missing evidence>`, `BLOCKED — <exact external
dependency>`, `DEFERRED — <exact stage/reason>`.

## What Stage 9 delivered

The platform's authorization model was a set of `demo anon ... using (true)`
policies from July, because two structural facts made the intended model inert:
the browser holds a Supabase publishable key (so PostgREST is directly
reachable), and a Next.js server action runs before any page guard.

Measured, not asserted: a direct-Data-API probe against two disposable tenants
scored **26 failures out of 67 checks before, 0 out of 108 after**.
Unauthenticated, an attacker could read every profile, student record, enrolment
and syllabus; rewrite any profile; create a profile with `role=admin`; fabricate
or delete counseling availability; and deliver a notification to any user. Four
plaintext accounts including the administrator shipped in the production client
bundle.

Root cause of the whole family: every authenticated RLS policy compared
`auth.uid()` to a column holding `profiles.id`, so the authenticated layer had
never worked and the browser fell through to `anon`. Fixed at the identity layer
first (D-024), then the anon surface removed — `anon` now holds exactly one TABLE
privilege in `public` (SELECT on `schools`) and, since round 4, **no function
EXECUTE anywhere**. The earlier "exactly one privilege" wording was true of
tables and false overall.

Also delivered: a durable append-only audit trail with an explicit ACL (D-025),
the schema-drift repair that makes the migration chain rebuildable (D-026),
tenant suspension enforced at request time, and a live security probe harness
with specific, tested guarantees (D-027): a deadline that covers the body read
and does not depend on the transport honouring an abort, cleanup that quiesces
in-flight work before deleting, and an automatic marker sweep so a create that
committed without acknowledging is still found. **Not** "trustworthy by
construction" — round 4 corrected that wording, because round 3's version of two
of those guarantees was incomplete.

## What the review rounds added

**Round 1 → 2.** Stage 9's own security probe could leak fixtures and Auth users
(6 of 6 injected provisioning failures leaked; a live run had already left 4
posts and 2 `course_reviews` behind while reporting clean), and ownership-only
write policies still allowed cross-tenant writes on five tables. Both closed.
Fixing them exposed two defects Stage 9 had introduced: a revoked grant that
silently broke a professor action, and an append-only audit trigger that turned
the audit trail into a lock on user deletion. The four historically exposed demo
credentials were **rotated**, not deferred.

**Round 2 → 3.** The central finding was that a security PASS was not yet
trustworthy: the probe had unbounded transport, no signal handling, an Auth
listing capped at one page, and a host guard a lookalike domain could defeat.
That was fixed first (F1), and only then were destructive live probes resumed.
The remaining eleven findings were three provenance/tenant holes in the data
model (F2–F4), two lost-update races that both notified students twice (F5, F6),
an append-only claim with no ACL behind it (F7), four regressions Stage 9 itself
had caused (F8–F11), and a security snapshot that recorded names rather than
semantics (F12).

Two round-3 findings were **not** what the report said, and are recorded that
way: F2's reported exploit was blocked only incidentally by SELECT-policy
visibility — the real defect was wider (`course_id` was entirely unconstrained);
and F11's reported filter defect came with a second, independent one (the auth
handshake raced the subscription).

Verifying the round-3 fixes exposed one further self-inflicted defect: the F5
transition matrix was exported from a `"use server"` module, where every export
becomes a remotely invocable endpoint, and **`next build` failed**. A new guard
now fails that class of defect in the unit suite instead of at build time.

**Round 3 → 4.** Nine substantive findings, all confirmed. A role broadcast was
stored ONCE with a shared mutable `is_read`, so the first student to open a
tenant announcement marked it read for the whole cohort — 14 such rows existed
live and 12 had already been flipped. Any authenticated staff member could
publish a student-voice course review. The weekly AI advance discarded the
authorized enrollment's primary key, then compare-and-set on a predicate that
could move MORE rows than authorization had inspected, and wrote feedback before
finding out whether it had won. The probe's signal handler began destructive
cleanup while requests were still in flight, and its deadline only worked if the
transport co-operated. The security snapshot recorded a function's raw ACL,
which renders as the reassuring string "DEFAULT" in exactly the case where
PostgreSQL grants EXECUTE to PUBLIC.

Two round-4 findings were wider than reported, and each was found by building
the check rather than by taking the report at its word: the new effective-EXECUTE
guard immediately caught two demo-era RPCs `anon` could still call, and verifying
the notice-DELETE property turned up `authenticated` holding TRUNCATE — which
RLS cannot restrain — on 31 of 54 tables.

## Verified this stage (round-4 numbers, all freshly run)

- Live direct-Data-API probe **108 checks / 0 failed**, residue clean
- Live durable-audit probe **12 / 0**; live notification RLS **10 / 0**
- Whole repository suite: see the final battery below
- The 3 failures are the **pre-existing KI-002 trio**, confirmed by running the
  same two untouched test files on `origin/main` in a clean worktree — the same
  three names fail there
- The 3 skips are the subprocess POSIX-signal tests on Windows. Round 4 narrowed
  what that skip means: the HANDLER is proven on every platform, both by an
  injected process emitter and by an IPC-cancel test that drives the real runner
  in a real child process. Only the OS signal DELIVERY mechanism is unexercised
  there, and it is recorded as UNVERIFIED rather than passed
- Security snapshot `--check`: matches the live database
- `tsc --noEmit` exit 0; `next lint` exit 0 (1 pre-existing warning);
  `next build` exit 0, 26 routes, shared JS 102 kB unchanged
- Credential scan: 202 shipped files across `.next/static` + `.next/server`,
  0 hits (the one `.next/cache/webpack` match predates the rotation commit and
  is gitignored and never served)
- `git diff --check` clean

## NOT verified / BLOCKED

- **Rendered browser QA — UNVERIFIED — the browser preview tool was blocked by
  the session's permission classifier, so no page was rendered.** The
  user-visible changes from rounds 3 and 4 (`/support` sessionless refusal,
  `/admin` stale banner, `/professor` assistant workspace, the notification
  bell, `/reviews` refusing a non-student, and per-person notification read
  state) have build, typecheck and unit-guard coverage but no rendered
  evidence. Required before merge.
- **Realtime delivery — UNVERIFIED — requires a real socket and a real INSERT.**
  Both client-side defects are fixed and RLS was not weakened, but the channel
  is off by default and end-to-end delivery was never exercised.
- **No verified recovery point of any kind.** PITR off, backup list empty, no
  backup mechanism in the repo. No RPO/RTO is claimed.
- **Full-chain schema rebuild — BLOCKED — NON-PRODUCTION DATABASE REQUIRED.**
  The drift repair is reasoned and unit-guarded, not proven by execution.
- **Probe crash safety is NOT claimed.** SIGINT/SIGTERM run cleanup once and
  exit 130/143. SIGKILL, power loss or a host crash leave ledgered fixtures
  behind; the next run's residue verification is what catches that.
- **Audit test events are permanent.** The probe cannot delete its own audit
  rows — production append-only behaviour was not weakened for testing
  convenience — so its events remain in `security_events` and are reported
  rather than cleaned up.
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
- UI/UX changes beyond what a confirmed security finding forced. Round 3 changed
  user-visible behaviour in exactly two places, both required by a finding:
  `/support` now requires a session (F8), and `/admin` gained a "이미 처리된
  요청입니다" message for a decision that loses the CAS (F5). Round 4 changed two
  more, also finding-driven: `/reviews` refuses a non-student ("수강 후기는
  학생만 작성할 수 있습니다"), and marking a tenant announcement read no longer
  clears it for everyone else.

## Completion rule

Stage 9 work completes on the branch only; merging requires external review and
human approval. Never merge automatically. Never start Stage 10 automatically.
Repository state is the source of truth.
