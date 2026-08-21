# Stage 10 Recovery and Rebuild Evidence

Date: 2026-08-21 (Asia/Seoul)

## Safety boundary

Production project `szztsqdnvenfbgxtylkl` was never used for reset, rebuild,
restore, recovery, fixture, or load testing. The repository now refuses that
ref through a compiled denylist shared by the security and load harnesses;
since the 2026-08-22 final-blocker fix the security-probe guard recognises it
on the canonical (trimmed, lower-cased) form of the configured ref and rejects
malformed configured refs fail-closed (repository-local evidence, D-041).
`supabase/config.toml` is local-only and contains no cloud ref or secret. The
reset wrapper accepts only a running stack whose reported API URL is loopback.

## Read-only cloud capability inspection

The available project inventory contained production plus three unrelated,
inactive projects. None was documented or approved as Pacemate scratch
infrastructure, so none was repurposed. Production backup metadata was read
without mutation:

- `walg_enabled`: `true`
- `pitr_enabled`: `false`
- listed backups: `0`

Result: **BLOCKED — no verified recovery point and no approved disposable
restore target.** No backup restoration was attempted. No RPO or RTO is
claimed because there was no recovery point to restore and no measured drill.

## Local migration-chain attempt

Repository support:

- Supabase CLI pinned at `2.115.0` in both lockfiles.
- local PostgreSQL major version pinned at `17`.
- migrations enabled; seeds disabled for rebuild proof.
- `npm run supabase:reset` invokes a loopback-checking wrapper and the exact
  `supabase db reset --local --no-seed` operation only after that check.

Observed execution:

1. Docker Desktop was started and its engine reported healthy server version
   `29.1.3`.
2. `npm run supabase:start` failed before database creation while public ECR
   images repeatedly returned EOF / Docker API 500.
3. A direct pull of
   `public.ecr.aws/supabase/postgres-meta:v0.98.0` reproduced the Docker API 500.
4. `npm run supabase:reset` then refused to reset because no local Supabase
   stack was running.

Result: safety guard **PASS**; clean rebuild **BLOCKED / UNVERIFIED** because
the container image could not be obtained. This is not a migration failure and
must not be cited as proof that the migration chain rebuilds.

## Required follow-up evidence

On an approved disposable environment, run the clean rebuild, verify migration
postconditions and the generated security snapshot, then perform a restore
drill from an actual recovery point. Record elapsed restore time and data-loss
window before publishing any RTO/RPO.
