# Stage 9 — Durable Audit and Recovery Capability

## 1. Operational logs vs an audit trail

Stage 8 (D-023) built structured operational logging: JSON events with a field
allowlist, an `ok/conflict/denied/user_error/fault` taxonomy, correlation ids,
and Next's `onRequestError`. That answers *is the system healthy right now*, and
it lives in the platform's log retention window.

An audit trail answers *who changed this identity, privilege or tenant setting,
and when* — asked months later, usually during a dispute or an incident. Before
Stage 9 the platform had none. Several security-relevant actions had **no record
at all**, not even a log line: tenant-wide admin broadcasts, counseling status
transitions, and hard deletes.

## 2. What actually needs durable history

Chosen by asking "would its absence make an incident unreconstructable?", not by
logging everything.

| Event | Before | Needs durability? |
|---|---|---|
| SSO account linking / JIT provisioning | stdout | **Yes** — these *create or bind an identity*. Highest value. |
| SSO login denials | stdout | **Yes** — a burst against one subject hash is the only signal of a targeted attempt. |
| Tenant-wide admin broadcast | **nothing** | **Yes** — one click writes a row per profile in the tenant. |
| Curriculum revision approval | **nothing** | **Yes** — publishes a patch into every student's roadmap. |
| Password-login denial | stdout, reason code only | Yes eventually — it is also the unlock for per-account throttling (KI-021). Not wired this stage. |
| Counseling status transitions | conflicts/faults only | Yes eventually — correctness-critical per CLAUDE.md. Not wired this stage. |
| Hard deletes | nothing | Yes eventually. |
| Every access denial | nothing | **No.** A counter suffices; per-event rows would make this a request log. |
| Page requests | — | **No.** Explicitly excluded. |

## 3. Options weighed

**A — platform logs only.** Zero build cost. Rejected: retention is outside our
control, events cannot be queried by tenant, and it does nothing for the actions
that emit no line at all.

**B — a minimal append-oriented table written through the existing chokepoints.**
Chosen. `emitSsoAuditEvent` and `logEvent` are each a single function whose
output shape is already frozen by tests, so a durable sink swaps in with **no
call-site changes** — `sso-audit.ts` was written in Stage 7 explicitly to be
this seam.

## 4. What was built

`public.security_events` (`20260814030000`):

```
occurred_at, event, outcome, actor_profile_id, actor_role, school_id,
subject_type, subject_id, request_id, detail,
actor_ref, school_ref, actor_role_ref          -- immutable snapshots (Codex F8)
```

Design decisions and their reasons:

- **No secrets and no large PII.** `detail` is a short classification string,
  `check (length(detail) <= 200)` so the column cannot become an accidental PII
  sink. Subjects are opaque ids or a truncated hash — never a name or an email.
- **`request_id`** ties a durable row to the Stage 8 operational line.
- **No client role may write.** `revoke all ... from public, anon, authenticated`,
  `grant select` only, and **no non-SELECT policy exists** — asserted as a
  migration postcondition. The application writes through the service role.
- **Privileged read is tenant-scoped**: a tenant admin sees their own tenant's
  events, nothing else.
- **Attribution is an immutable snapshot, not a nullable pointer (Codex F8).**
  `actor_profile_id` and `school_id` were ON DELETE SET NULL, so deleting a
  profile blanked the actor and tenant of every historical event referencing it —
  exactly the rows an investigation needs after an account is removed.
  `actor_ref` / `school_ref` / `actor_role_ref` are text copies written by a
  BEFORE INSERT trigger, so no caller can forget them, and `actor_role_ref`
  records the role AS IT WAS, which no live join can reconstruct after a role
  change. The FK CONSTRAINTS were then dropped entirely: with the append-only
  trigger in place a SET NULL cascade IS an update, so the trigger refused it and
  deleting a profile with audit history failed outright — turning the audit trail
  into a lock on user deletion. An audit record now references nothing that can
  null it, block it or cascade it.
- **Append-only is enforced by the database.** A BEFORE UPDATE trigger rejects
  every update, including by the service role.
- **Best-effort, stated as such.** `recordSecurityEvent` emits the operational
  line first and unconditionally; if the durable insert fails it logs
  `audit.write_failed` and the caller proceeds. Auditing must not break the
  action being audited. That is a deliberate availability-over-completeness
  trade, so the trail is best-effort rather than guaranteed. The SSO path now
  AWAITS the write (Codex F8) — a durable write the caller never waits on is not
  durable.
- **DELETE remains available to service_role.** Retention pruning is a
  foreseeable need and no retention policy exists yet. A compromised
  service-role key can therefore still remove history. Stated, not implied.

**Not claimed: this is not tamper-proof.** There is no hash chain and no
signature. A compromised service-role key can write false rows; what it cannot
do is quietly edit or delete true ones through any role the browser can reach.

Wired this stage: all five SSO identity events, `admin.broadcast_sent`,
`admin.broadcast_failed`, `admin.revision_{assistant_reviewed,approved,rejected}`.
The table's security properties are verified live by
`scripts/security/audit-trail-probe.mjs` (11/11): service_role can append and
read; anon cannot read, append, update or delete; an audit record cannot be
updated even by service_role; the snapshot populates automatically; a profile
carrying audit history can still be DELETED; and its attribution survives that
deletion.

The three application emit paths (`sso.*`, `admin.broadcast_sent`,
`admin.revision_*`) are code-wired, typechecked and awaited, but no run in this
session triggered an SSO exchange, a tenant broadcast or a revision approval —
so the end-to-end write from those call sites remains **UNVERIFIED at runtime**.

## 5. Recovery capability — what actually exists

Verified with the tooling available, not assumed.

| Capability | Status |
|---|---|
| Supabase PITR | **`pitr_enabled: false`** — verified via `supabase backups list --project-ref szztsqdnvenfbgxtylkl` |
| Physical backups listed | **`backups: []`** — same call. `walg_enabled: true` |
| Plan-tier daily logical backups | **BLOCKED — check Supabase dashboard → Project Settings → Database → Backups** for existence and retention. Not surfaced by the CLI. |
| Backup mechanism in the repo | **None.** No dump script, no cron, no CI. |
| Migration history integrity | **Healthy.** All 55 local migrations have a matching remote entry. This **resolves the open half of KI-006** — `20260812000000` is recorded as applied and no `migration repair` is pending. |
| Schema rebuildable from migrations | **Was NO, now yes for the known gap.** Ten hand-applied columns existed in no migration, and the chain aborted at `20260812070000`. Repaired by `20260814020000` plus an additive guard at the first point of use. **Still UNVERIFIED end-to-end** — see below. |
| `supabase/schema.sql` usable as a fallback | **No.** Duplicate `day_of_week` in `professor_admin_tasks` (KI-005), a `$$$` delimiter typo, mojibake, two tables that do not exist live, and 25 live tables missing. Not authoritative; not used as evidence in this stage. |
| Down migrations | **None.** Every migration is forward-only. |
| Seed usable for recovery | **No.** `supabase/seed/` holds nine SQL files that no tooling invokes; there is no `supabase/config.toml`. |
| Application rollback | Vercel dashboard "Promote to production" on a previous deployment. Application only — **there is no corresponding database rollback**. |
| Secret/config recovery | Six variables; see RECOVERY_RUNBOOK.md §3.5. `OPENAI_API_KEY` is required but **missing from `.env.local.example`**. `.vercel/.env.production.local` is stale and not a usable source. **BLOCKED — the authoritative production list is only in the Vercel dashboard.** |

## 6. What recovery was actually tested

| Exercise | Result |
|---|---|
| Migration chain applies cleanly forward against the live DB | **PASS** — five Stage 9 migrations applied, each with preconditions and postconditions that abort the transaction on violation |
| A postcondition genuinely fails closed | **PASS, demonstrated** — the first `db push` aborted and rolled back on my own over-strict assertion (`anon still has policies: schools.public read schools`); nothing was applied until it was corrected |
| Schema drift repair is idempotent against a populated DB | **PASS** — `20260814020000` is a no-op live and asserts all ten columns afterwards |
| Migration history reconciled | **PASS** — 55/55 local↔remote |
| Probe fixtures create and tear down deterministically | **CORRECTED — this claim was FALSE when first written.** Fault injection later disproved it: the provisioner only handed its fixture list to the caller on the happy path, so a mid-provision failure orphaned everything created so far, including Auth users; 6 of 6 injected failures leaked. A live run also left 4 posts and 2 course_reviews behind while residue verification reported clean, because those tables were missing from the residue list and their parents are ON DELETE SET NULL. Both are fixed (ledger + expanded coverage) and the property now holds — see the row below |
| Probe cleanup survives failure (Codex F1) | **PASS** — 27 fault-injection tests: every provisioning boundary, the Auth-user boundary, failure during the probe, a provisioner that never returns, DB and Auth deletion failures, unverifiable residue, delete scoping and LIFO ordering. Cleanup failures and unverifiable residue now fail the run |
| Audit trail resists client mutation | **PASS — 12/12 live (round 3).** Round 3 (F7) also found that this rested on the *absence of a policy* while the underlying table privileges were platform defaults. `20260814140000` now states the ACL explicitly: everything revoked from `public`, `anon`, `authenticated` and `service_role`, then `SELECT` to `authenticated` and `INSERT, SELECT` to `service_role`. `service_role` deliberately holds neither UPDATE nor DELETE |
| Probe cleanup survives interruption (round 3, F1) | **PASS** — SIGINT and SIGTERM run cleanup exactly once (latched on a promise) and exit 130/143, verified with an injected process handle in `lib/probe-lifecycle.test.mjs` (10 tests) and against a real spawned runner in `probe-subprocess.test.mjs` (7 tests; 3 signal tests **skip on Windows** with an explicit reason, never a pass). **No crash safety is claimed** — SIGKILL, power loss or a host crash leave ledgered fixtures behind, and what catches that is the next run's residue verification |
| Probe transport cannot hang (round 3, F1) | **PASS** — one bounded request path (`lib/probe-http.mjs`) whose deadline covers the **body read**, not just the response headers. A mid-body stall aborts within the deadline instead of hanging the run |
| Residue enumeration is exhaustive (round 3, F1) | **PASS** — `listUsersByEmailPrefix` pages the GoTrue admin API to exhaustion and **throws** if it does not terminate, instead of reporting a clean first page |
| **Full-chain rebuild into an empty database** | **BLOCKED — NON-PRODUCTION DATABASE REQUIRED.** Docker is not running, there is no `supabase/config.toml`, and the only Supabase project is live production. The D-1 repair is therefore *reasoned and unit-guarded* (`stage9_rls.test.mjs` asserts the column is added before it is asserted on) but **not proven by execution**. |
| **Restore from backup** | **BLOCKED — NO BACKUP EXISTS TO RESTORE FROM** (PITR off, backup list empty). Not attempted; no destructive drill was run against production. |

**No RPO or RTO is claimed.** On the evidence above there is no verified
recovery point of any kind. That is the single most serious operational finding
of this stage and it cannot be fixed from the repository — it needs a plan/
dashboard change plus an external backup destination.


---

## 7. Round 3 — the audit trail is not weakened for testing

Two constraints were held deliberately, and both cost something:

**The probe cannot delete its own audit rows.** `service_role` holds `INSERT`
and `SELECT` on `security_events` and nothing else, so the audit-trail probe's
test events remain in the table permanently. The probe reports them rather than
cleaning them up. The alternative — granting DELETE so the harness could tidy
after itself — would have made the append-only property a matter of convention
in production in order to keep a test run neat. That is the wrong trade.

**Attribution is preserved by snapshot, not by foreign key.** Round 2 found the
append-only trigger rejecting the `ON DELETE SET NULL` cascade, which turned the
audit trail into a lock on user deletion — a privacy problem created by an
integrity mechanism. The FK constraints were dropped and attribution now lives
in immutable snapshot columns written by a trigger at event time. Verified live
this round: a profile carrying audit history **can** be deleted, and its
`actor_ref` and `role_ref` survive the deletion.

## 8. What is still not claimed

- **No RPO, no RTO.** Unchanged and still the most serious operational finding.
- **Not tamper-proof.** No hash chain, no signature, no append-only storage
  outside Postgres. An actor with database-owner rights can still rewrite
  history; the ACL raises the bar, it does not remove the possibility.
- **Not crash-safe.** See the probe row above.
- **Full-chain rebuild — BLOCKED — NON-PRODUCTION DATABASE REQUIRED.**
- **Restore from backup — BLOCKED — NO BACKUP EXISTS TO RESTORE FROM.**


---

## 9. Round 4 — the audit probe joins the harness, without weakening the trail

Codex round 4, finding 7: the product's ACL semantics were correct, but the
probe VERIFYING them was the last one still on a bare `fetch` with no deadline,
with teardown that swallowed its own failures (`.catch(() => {})`) and no signal
handling at all. A verification tool that can hang, or that reports success it
did not observe, is not evidence.

It now shares the same harness as every other probe: the bounded transport, one
cancellation scope, a caller-owned ledger for the disposable profile, and
signal-aware cleanup whose result gates the exit code.

**What was deliberately NOT done.** The probe still cannot delete the audit
events it writes, and no DELETE was granted to make that possible.
`service_role` holds `INSERT` and `SELECT` on `security_events` and nothing
else. Its test events therefore remain in the trail permanently. They are
reported at the end of every run with their count and marker, so the residue is
visible rather than discovered later. Two guards keep it that way:
`probe-cleanup.test.mjs` asserts the probe never ledgers a `security_events`
row (the ledger deletes) and never attempts a bulk removal of its own events,
and the snapshot guard asserts no role holds UPDATE, DELETE or TRUNCATE on the
table.

**Expected residue semantics, stated plainly.** After a successful audit-probe
run the database contains N rows whose `event` begins `stage9-audit-probe.`.
That is correct behaviour, not a leak. They carry no personal data. Removing
them requires a privileged out-of-band operation, which is the same constraint
a real retention policy will face — and that constraint is the point.
