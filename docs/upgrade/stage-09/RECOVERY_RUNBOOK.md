# Stage 9 — Recovery Runbook

Every step below uses a command or a file that **exists in this repository
today**. Where something is impossible, it says so instead of describing a
procedure that would fail when it is needed.

**Read first:** there is no PITR (`pitr_enabled: false`, verified) and the
physical backup list is empty. Whether plan-tier daily logical backups exist is
**BLOCKED — check Supabase dashboard → Project Settings → Database → Backups**.
Several procedures below depend on that answer. Establish it *before* an
incident, not during one.

---

## 0. Triage — the first five minutes

1. **Is data being changed right now?** If a credential is suspected
   compromised, go to §3 first; rotation is faster than analysis.
2. **Snapshot before you touch anything.** With Docker available:
   `npx supabase db dump --linked -f incident-$(date +%s).sql`.
   Without Docker this is unavailable — take a targeted export instead via
   PostgREST with the service key (`GET /rest/v1/<table>?select=*`).
3. **Establish blast radius from the audit trail:**
   ```sql
   select * from public.security_events order by occurred_at desc limit 200;
   ```
   Note: the trail starts 2026-08-14. Nothing before that date is recorded.
4. **Correlate to operational logs** via `request_id` in the Vercel log drain.

---

## 1. Bad migration

**Identify.** `npx supabase migration list --linked` shows local↔remote. A
migration that half-applied is not possible for Stage 9 migrations — each is
wrapped in `begin/commit` with postconditions that `raise exception`, so a
violated invariant rolls the whole file back. This behaved correctly in
practice: the first Stage 9 push aborted on a bad assertion and applied nothing.

**Stop the rollout.** There is no automatic migration runner — `db push` is
manual. Stop by not running it again.

**Recover.** In order of preference:

1. **Forward-fix.** Write a new migration that corrects the state. This is the
   only mechanism that always works: there are **no down migrations** anywhere
   in this project, and `migration repair --status reverted <version>` only
   edits the history table — **it does not undo DDL**.
2. **Restore.** Only if §0 established that a backup exists. Otherwise
   unavailable.

**Rehearsal.** Currently impossible — see §6. Treat every migration against this
project as unrehearsed, which is why Stage 9 migrations carry explicit
preconditions and postconditions.

---

## 2. Data corruption

**Scope it.** There is exactly **one** live tenant, so "one tenant" is currently
the whole database. Scope by table and time:

```sql
select count(*) from <table> where updated_at > '<incident start>';
```

**Restore without overwriting unrelated tenants.** A full restore is
tenant-blind. When a second tenant exists, the correct move is a targeted
re-import of the affected tenant's rows from an export, not a whole-database
restore. **No per-tenant export exists today** — building one is a prerequisite
for this procedure being real, and is recorded in KI-022.

**Do not** run a destructive restore drill against production. None was run in
Stage 9.

---

## 3. Credential compromise

### 3.1 `SUPABASE_SERVICE_ROLE_KEY`

Blast radius while live: full read/write on all 54 tables, bypassing every RLS
policy, plus GoTrue admin (create/delete users).

1. Supabase dashboard → Project Settings → API keys → rotate the secret key.
2. Update `.env.local` and the Vercel environment variable.
3. Redeploy (the key is read at client construction, so a redeploy is required).
4. **You cannot determine what the attacker did.** There is no service-role
   access log. `security_events` records only what the *application* chose to
   record, and a direct PostgREST caller with the key bypasses it entirely.
   Assume full read of everything in the PRIVACY_DATA_MAP inventory.

### 3.2 `PACEMATE_SESSION_SECRET`

The cleanest rotation available. Changing it invalidates every HMAC app session
immediately, because verification is a signature check with no server-side store
(`src/lib/auth/demo-session.ts`, ≥32 bytes enforced).

1. Generate a new value ≥32 bytes.
2. Update `.env.local` + Vercel, redeploy.
3. All users are signed out. This is also the **only in-app mass session
   revocation that exists** — see §4.

### 3.3 `OPENAI_API_KEY`

Rotate at OpenAI; update `.env.local` + Vercel; redeploy. Five call sites read
it from the environment; no code change needed.

### 3.4 Demo account passwords — **outstanding action**

`src/config/demo-users.json` holds four plaintext passwords, including
`admin1@pacemate.edu`. Until Stage 9 they were shipped in the public client
bundle and were readable by anyone with `curl`. The exposure is closed
(`import "server-only"` + `PACEMATE_ENABLE_DEMO_LOGIN` gate, verified absent
from `.next/static/**`), but **the credentials themselves must still be
rotated** — they were public for the lifetime of every prior deployment.

1. Supabase dashboard → Authentication → Users → reset the password for
   `student1@`, `prof1@`, `assistant1@`, `admin1@pacemate.edu`.
2. Update `src/config/demo-users.json` and
   `scripts/ensure-demo-operator-auth.mjs`.
3. Consider deleting the `admin1@` demo account outright — a privileged demo
   account is a standing risk with no product purpose.

### 3.5 SSO client secrets

Held in Supabase Auth provider configuration, not in this repository.
**BLOCKED — rotate at Supabase dashboard → Authentication → Providers.**

### 3.6 Supabase Management API token

The CLI is authenticated from the Windows credential store
(`LegacyGeneric:target=Supabase CLI:supabase`). It grants access to **four
projects across the organisation**, so its compromise is an org-wide event.
Rotate at supabase.com → Account → Access Tokens, then `supabase login` again.

### 3.7 Rebuilding `.env.local` from scratch

| Variable | Source |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `supabase/project.json`, `.env.local.example` (public) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase dashboard → API keys (public) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase dashboard → API keys (secret) |
| `PACEMATE_SESSION_SECRET` | operator-generated, ≥32 bytes |
| `OPENAI_API_KEY` | OpenAI dashboard — **not in `.env.local.example`; add it** |
| `PACEMATE_SSO_PROVIDERS` | documented in `.env.local.example`; optional |
| `PACEMATE_ENABLE_DEMO_LOGIN` | set to `1` only in QA; leave unset in production |

`.vercel/.env.production.local` is **stale** (July 6) and lacks the service-role
key and session secret. Do not use it. **BLOCKED — the authoritative production
list is only in the Vercel dashboard → Settings → Environment Variables.**

---

## 4. Authorization / RLS regression

**Fail closed immediately.** The fastest global containment is §3.2: rotate
`PACEMATE_SESSION_SECRET`, which signs every user out. To close a specific
table:

```sql
revoke all on public.<table> from anon, authenticated;
```

RLS is already enabled on all 54 tables, so removing the grant is sufficient and
reversible.

**Verify.** Run the probe:

```bash
PACEMATE_SECURITY_PROBE_ALLOW_WRITES=1 PACEMATE_SECURITY_PROBE_PROJECT_REF=<ref> node scripts/security/rls-probe.mjs
```

67 checks across anon, cross-tenant and legitimate-path cases. It provisions and
removes its own tenants. Also `node scripts/verify-notification-rls.mjs` for the
Stage 8 notification properties.

**Cheap manual check** — distinguishes "no grant", "policy denies" and "exposed"
in one request:

```bash
curl -s -H "apikey: $PUBLISHABLE" -H "Prefer: count=exact" \
  "$URL/rest/v1/<table>?select=id&limit=1" -i | head -20
```

`401 / 42501` = no grant · `200` with `0/N` = policy denies · `200` with rows = exposed.

**Confirm the invariant holds:**

```sql
select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema='public' and grantee='anon' and table_name <> 'schools';
```

This must return **zero rows**. It is the postcondition `20260814010000`
asserts.

---

## 5. Deployment regression

1. Vercel dashboard → Deployments → previous good build → **Promote to
   Production**.
2. **Check whether the bad deployment shipped a migration.** Application
   rollback does not roll back the database. If it did, go to §1 — and note that
   Stage 9 migrations are written to be forward-compatible with the previous
   application version wherever possible.
3. Re-run `npm run build` and `node scripts/check-bundle-budgets.mjs` locally
   before promoting anything forward again.

Stage 10 owns CI/CD; today every gate (tests, budgets, RLS probe) is manual and
there is **no `test` script in `package.json`**.

---

## 6. What is impossible today

Stated plainly so nobody plans around a capability that does not exist.

| Want | Reality |
|---|---|
| Point-in-time restore | `pitr_enabled: false` |
| Restore from a physical backup | backup list is empty |
| Roll a migration back | no down migrations; `migration repair` only edits history |
| Rehearse a migration | no `supabase/config.toml`, Docker not running, no non-production project |
| Rebuild the schema into a fresh database and prove it | **BLOCKED — NON-PRODUCTION DATABASE REQUIRED.** The known blocker (ten hand-applied columns) is repaired by `20260814020000` + the guard in `20260812070000`, but the rebuild has **not been executed** |
| Restore one tenant without touching others | no per-tenant export exists |
| Know what a stolen service-role key read | no service-role access log |
| Revoke a single user's session | no server-side session store; the HMAC cookie is valid until its 8h expiry. Global revocation via §3.2 is the only lever |

## 7. Prerequisites to make this runbook real

In priority order. None can be done from the repository alone.

1. Establish and record whether daily logical backups exist, and their
   retention. Enable PITR if the plan allows.
2. Add an **external** scheduled logical dump — a hosted-only backup shares a
   failure domain with the thing it protects.
3. Create a non-production Supabase project. It unblocks the rebuild proof, the
   restore drill, migration rehearsal, and the Stage 8 load tiers.
4. Add `supabase/config.toml` (+ `seed.sql_paths`) so `supabase db reset`
   becomes the standing regression test for schema-drift recurrence.
5. Rotate the four demo passwords (§3.4).
