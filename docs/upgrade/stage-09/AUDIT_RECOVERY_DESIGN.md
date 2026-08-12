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
subject_type, subject_id, request_id, detail
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
- **Best-effort, stated as such.** `recordSecurityEvent` emits the operational
  line first and unconditionally; if the durable insert fails it logs
  `audit.write_failed` and the caller proceeds. Auditing must not break the
  action being audited. That is a deliberate availability-over-completeness
  trade, so the trail is best-effort rather than guaranteed.

**Not claimed: this is not tamper-proof.** There is no hash chain and no
signature. A compromised service-role key can write false rows; what it cannot
do is quietly edit or delete true ones through any role the browser can reach.

Wired this stage: all five SSO identity events, `admin.broadcast_sent`,
`admin.broadcast_failed`, `admin.revision_{assistant_reviewed,approved,rejected}`.
The table's security properties are verified live (5/5). The three application
emit paths are code-wired and typechecked but were **not** triggered at runtime
this session — recorded as UNVERIFIED in the test matrix.

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
| Probe fixtures create and tear down deterministically | **PASS** — two full runs, baseline restored exactly both times |
| Audit trail resists client mutation | **PASS** — 5/5 live |
| **Full-chain rebuild into an empty database** | **BLOCKED — NON-PRODUCTION DATABASE REQUIRED.** Docker is not running, there is no `supabase/config.toml`, and the only Supabase project is live production. The D-1 repair is therefore *reasoned and unit-guarded* (`stage9_rls.test.mjs` asserts the column is added before it is asserted on) but **not proven by execution**. |
| **Restore from backup** | **BLOCKED — NO BACKUP EXISTS TO RESTORE FROM** (PITR off, backup list empty). Not attempted; no destructive drill was run against production. |

**No RPO or RTO is claimed.** On the evidence above there is no verified
recovery point of any kind. That is the single most serious operational finding
of this stage and it cannot be fixed from the repository — it needs a plan/
dashboard change plus an external backup destination.
