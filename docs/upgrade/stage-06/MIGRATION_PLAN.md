# Stage 6 — Migration Plan

Date: 2026-08-12. Incremental, verifiable steps (spec §25). Each migration is
a single concern with preconditions, backfill, validation (must return 0
offending rows before a constraint is added), rollback, and postconditions.
No giant one-shot migration; no data lost or silently reassigned.

## Environment facts (verified this session)

- Supabase CLI is authenticated and the pacemate project is linked; `db push`
  works against the remote. Migration history was REPAIRED for
  `20260812000000` (applied via SQL editor, was missing) — done 2026-08-12,
  `db push --dry-run` now reports "up to date". This is the precondition for
  every step below.
- Live tenant state (introspection 2026-08-12): 1 school
  (`862b661c-810a-4440-ba76-722b2fcf8d6a`, 계명대학교) = the default tenant;
  1 populated department under it; all 3 professors link to it via
  `department_id`; all 9 courses already have `school_id` set; `profiles`
  has ~9+ NULL `school_id` rows (professors/admins/some students);
  `user_notifications` (129 rows) has no tenant column.
- The GiST constraint `counseling_requests_no_active_overlap` exists live and
  is NOT modified by any migration here.

## Migration sequence

Each file is a new timestamped migration under `supabase/migrations/`. Apply
with `npx supabase db push --linked` after a `--dry-run`. Run the validation
query (via `npx supabase db query "..." --linked`) after each apply.

### M1 — `schools`: tenant metadata

DDL: `alter table public.schools
  add column if not exists status text not null default 'active'
    check (status in ('active','suspended')),
  add column if not exists slug text unique;`

- Precondition: schools exists (yes).
- Backfill: none (defaults). Optionally set slug for the default tenant in a
  seed, not required.
- Validation: `select count(*) from schools where status not in
  ('active','suspended')` → 0.
- Rollback: `alter table drop column status, drop column slug`.
- Postcondition: every school row is 'active'; resolver can deny suspended.

### M2 — `professors.school_id` (backfill from department, then NOT NULL)

DDL step A: `alter table public.professors
  add column if not exists school_id uuid references public.schools(id);`
Backfill: `update public.professors p set school_id = d.school_id
  from public.departments d
  where d.id = p.department_id and p.school_id is null;`
For any professor whose `department_id` is NULL (none live, but defensive):
`update public.professors set school_id = (select id from public.schools
  limit 1) where school_id is null;` guarded by the single-tenant
precondition (M0 assertion below).
DDL step B: `create index if not exists professors_school_id_idx
  on public.professors(school_id);`
DDL step C (after validation): `alter table public.professors
  alter column school_id set not null;`

- Precondition: `(select count(*) from schools) = 1` (assert; the defensive
  backfill is only correct with one tenant).
- Validation (before step C): `select count(*) from professors where
  school_id is null` → 0.
- Rollback: drop the NOT NULL, then the index, then the column.
- Postcondition: every professor has a NOT NULL school_id; the counseling
  domain's tenant anchor exists.

### M3 — `user_notifications.school_id` (backfill, then NOT NULL)

DDL step A: `alter table public.user_notifications
  add column if not exists school_id uuid references public.schools(id);`
Backfill recipient rows:
`update public.user_notifications n set school_id = p.school_id
  from public.profiles p
  where p.id = n.recipient_id and n.school_id is null
    and p.school_id is not null;`
Backfill broadcast/remaining rows to the default tenant (single tenant):
`update public.user_notifications set school_id =
  (select id from public.schools limit 1) where school_id is null;`
DDL step B: `create index if not exists
  user_notifications_school_recipient_idx
  on public.user_notifications(school_id, recipient_role);`
DDL step C (after validation): `alter column school_id set not null`.

- Precondition: M5 (profiles backfill) should run FIRST so recipient-derived
  school_ids are populated; if M5 hasn't run, the recipient join simply
  falls through to the default-tenant backfill (still correct with one
  tenant). Ordering: run M5 before M3's backfill for cleanest provenance.
- Validation: `select count(*) from user_notifications where school_id is
  null` → 0.
- Rollback: drop NOT NULL, index, column.
- Postcondition: every notification (including broadcasts) carries a tenant.

### M4 — `courses.school_id` NOT NULL (already populated)

DDL: `alter table public.courses alter column school_id set not null;`

- Precondition/validation (BEFORE): `select count(*) from courses where
  school_id is null` → must be 0 (verified live: 0).
- Rollback: `alter column school_id drop not null`.
- Postcondition: `unique(school_id, code)` NULL-leak closed.

### M5 — `profiles.school_id` backfill + NOT NULL

Backfill: `update public.profiles set school_id =
  (select id from public.schools limit 1) where school_id is null;`
DDL (after validation): `alter table public.profiles
  alter column school_id set not null;`

- Precondition: `(select count(*) from schools) = 1`.
- Validation: `select count(*) from profiles where school_id is null` → 0.
- Rollback: `alter column school_id drop not null`. (Backfilled values are
  harmless to leave — every account genuinely belongs to the one tenant.)
- Postcondition: `resolveTenantContext` never sees a NULL-tenant profile.
- Note: `profiles.identifier` uniqueness is NOT changed (DESIGN §6.5).

### M6 — RLS / RPC tenant hardening (after all columns exist)

Single migration, transaction-wrapped:

1. Tighten counseling INSERT backstop — replace policy
   `users create counseling requests` (authenticated) so its WITH CHECK adds
   a tenant clause to the existing ownership check:
   ```
   with check (
     exists (select 1 from public.profiles p
       where p.id = counseling_requests.student_id
         and p.auth_user_id = (select auth.uid())
         and p.role = 'student'
         and exists (select 1 from public.professors pr
           where pr.id = counseling_requests.professor_id
             and pr.school_id = p.school_id)))
   ```
   Preserves the D-011-era ownership semantics; adds the DB tenant backstop.
2. Drop dead exposure: `drop policy if exists
   "demo anon update counseling requests" on public.counseling_requests;`
   and `revoke update on public.counseling_requests from anon;` (no app path
   uses it — AUDIT §6.4).
3. Tenant-scope the assistant branch of `answer_professor_questions`: derive
   the staff school_id and the escalation's school (via course_id →
   courses.school_id); the assistant authorization becomes
   `(v_staff_role='assistant' and <escalation.course.school_id =
   v_staff_school_id>) or e.professor_id = v_professor_id` in BOTH the count
   check and the UPDATE predicate. SECURITY DEFINER, `search_path=''`
   preserved.

- Precondition: M2/M5 applied (school_id columns exist on professors +
  profiles).
- Validation: policy exists with the new check
  (`select pg_get_expr(...)`); RPC recompiles; a same-tenant booking still
  inserts; a cross-tenant booking is rejected by the check (covered by the
  isolation suite).
- Rollback: restore the prior policy/function definitions (kept in the
  migration's down-notes).
- Postcondition: the booking tenant boundary holds even against a crafted
  authenticated PostgREST insert; the dead hardcoded-email policy is gone;
  assistants cannot answer cross-tenant questions.

## Ordering summary

M1 → M4 (courses, no dependency) → M2 (professors) → M5 (profiles backfill)
→ M3 (notifications, after M5) → M6 (RLS/RPC, after M2+M5). Each pushed and
validated independently. `db push --dry-run` before every real push.

## Global validation after all migrations

- `select table_name, count(*) filter (where school_id is null) as nulls
  from (…) ` per tenant column → all 0.
- Re-verify the GiST constraint is unchanged:
  `select pg_get_constraintdef(oid) from pg_constraint where conname =
  'counseling_requests_no_active_overlap'` → identical string.
- Full app test suite + Stage 2/5 regression + isolation suite green.

## Rollback posture

Every migration's constraint additions are reversible (drop NOT NULL / drop
column / drop index / restore policy). The backfilled tenant values are
semantically correct (single real tenant), so leaving them after a partial
rollback is safe. No migration deletes or reassigns row ownership across
tenants.
