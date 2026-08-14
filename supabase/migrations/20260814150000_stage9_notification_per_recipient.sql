-- Stage 9 (Codex round 4, finding 1) — notification read state is PER RECIPIENT.
--
-- THE DEFECT. A role broadcast was stored as ONE row with `recipient_id = NULL`,
-- `recipient_role = <role>` and `school_id = <tenant>`. Every holder of that
-- role in that tenant read the SAME row — and `is_read` is a column ON that row.
-- So the first student to open a tenant-wide announcement marked it read for
-- every other student. The RLS UPDATE policy explicitly permitted this: its
-- USING/WITH CHECK matched the role branch, so writing a peer's read state was
-- not a bypass, it was the designed behaviour.
--
-- Measured live before the fix: 14 shared broadcast rows, of which 12 were
-- already `is_read = true`. Those twelve had their unread state destroyed for
-- every recipient but one. Proven end to end by scripts/verify-notification-rls.mjs:
-- with a positive sentinel establishing that peer B was genuinely eligible,
-- student A marking the broadcast read flipped B's row to read as well.
--
-- WHY FAN-OUT AND NOT A RECEIPTS TABLE. Two designs were considered.
--
--   A. shared payload + a per-profile receipt table
--   B. fan the broadcast out into one row per recipient at creation time
--
-- B is chosen, for reasons that are evidence rather than taste:
--
--   * The platform ALREADY does this. `sendAdminBroadcastNotification` has
--     always written one row per profile in the tenant. The shared-row shape was
--     the exception, used by eight workflow call sites, not the norm.
--   * B makes the defect UNREPRESENTABLE. With `recipient_id NOT NULL` there is
--     no multi-recipient row for a shared mutable flag to live on. A receipts
--     table leaves the shared row in place and adds a second thing to keep
--     correct.
--   * B needs no new table, no join on every read, no rewrite of the unread
--     counts, no second Realtime subscription, and no change to mark-one-read
--     or mark-all-read. A leaves every one of those to be re-verified.
--   * B lets the RLS predicate collapse to `recipient_id = current_profile_id()`.
--     The role/tenant branch — the thing that made a peer's row writable — is
--     deleted rather than fenced off.
--
-- Cost of B, stated plainly: N rows instead of 1 per broadcast, bounded by the
-- number of profiles holding one role in one tenant. At present that is tens.
--
-- BACKFILL SEMANTICS. Each existing shared row is expanded to one row per
-- matching profile, carrying the shared `is_read` value forward. That value is
-- the best available reconstruction and is knowingly imprecise: the database
-- cannot know WHICH recipient actually read it. For the 12 already-read rows
-- this means everyone keeps "read"; nobody's unread badge suddenly resurrects
-- an old announcement. Going forward the state is genuinely per person.
--
-- Preconditions: user_notifications exists; every shared row carries a tenant
-- and a role (verified live: 14 of 14).
-- Postconditions: no row has a NULL recipient_id; the column is NOT NULL; no
-- surviving policy references recipient_role.
-- Rollback: forward-fix only. Reverting would recreate the shared mutable row.

begin;

-- Preconditions ------------------------------------------------------------
do $$
begin
  if to_regclass('public.user_notifications') is null then
    raise exception 'precondition failed: public.user_notifications is missing';
  end if;

  -- A shared row with no role or no tenant cannot be expanded to anyone. If one
  -- exists, stop rather than silently dropping a notification.
  if exists (
    select 1 from public.user_notifications
    where recipient_id is null and (recipient_role is null or school_id is null)
  ) then
    raise exception
      'precondition failed: % shared notification row(s) have no role or no tenant and cannot be fanned out',
      (select count(*) from public.user_notifications
       where recipient_id is null and (recipient_role is null or school_id is null));
  end if;
end $$;

-- Backfill ------------------------------------------------------------------
-- One row per (shared row × matching profile). `is_read` is carried forward;
-- see BACKFILL SEMANTICS above.
insert into public.user_notifications
  (recipient_id, recipient_role, school_id, target_group, category,
   title, body, target_href, is_read, created_at)
select
  p.id, n.recipient_role, n.school_id, n.target_group, n.category,
  n.title, n.body, n.target_href, n.is_read, n.created_at
from public.user_notifications n
join public.profiles p
  on p.school_id = n.school_id
 and p.role = n.recipient_role
where n.recipient_id is null;

-- The shared originals are now redundant. Deleting them is what makes the
-- NOT NULL below possible.
delete from public.user_notifications where recipient_id is null;

alter table public.user_notifications
  alter column recipient_id set not null;

-- Policies ------------------------------------------------------------------
-- Collapse to identity. A notification belongs to exactly one profile, and that
-- profile belongs to exactly one tenant, so recipient identity now subsumes the
-- tenant check the role branch used to need. This is strictly NARROWER than the
-- policy it replaces.
drop policy if exists "notifications readable by recipient or same-tenant role"
  on public.user_notifications;
drop policy if exists "notifications updatable by recipient or same-tenant role"
  on public.user_notifications;

create policy "notifications readable by their recipient"
  on public.user_notifications
  for select
  to authenticated
  using (recipient_id = app_private.current_profile_id());

create policy "notifications updatable by their recipient"
  on public.user_notifications
  for update
  to authenticated
  using (recipient_id = app_private.current_profile_id())
  with check (recipient_id = app_private.current_profile_id());

-- Postconditions ------------------------------------------------------------
do $$
declare
  orphan_count bigint;
  nullable boolean;
  role_policies bigint;
begin
  select count(*) into orphan_count
  from public.user_notifications where recipient_id is null;
  if orphan_count <> 0 then
    raise exception 'postcondition failed: % notification row(s) still have a NULL recipient', orphan_count;
  end if;

  select is_nullable = 'YES' into nullable
  from information_schema.columns
  where table_schema = 'public' and table_name = 'user_notifications'
    and column_name = 'recipient_id';
  if nullable then
    raise exception 'postcondition failed: user_notifications.recipient_id is still nullable';
  end if;

  -- The whole point: no policy may key off a role instead of an identity.
  select count(*) into role_policies
  from pg_policies
  where schemaname = 'public' and tablename = 'user_notifications'
    and (coalesce(qual, '') like '%recipient_role%'
      or coalesce(with_check, '') like '%recipient_role%');
  if role_policies <> 0 then
    raise exception
      'postcondition failed: % user_notifications policy/policies still match on recipient_role',
      role_policies;
  end if;
end $$;

commit;
