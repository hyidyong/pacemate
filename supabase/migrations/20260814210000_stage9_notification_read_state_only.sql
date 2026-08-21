-- Stage 9 (Codex round 5, F4) — a recipient may change their READ STATE, and
-- nothing else.
--
-- Round 4 fixed WHOSE row a recipient may write: broadcasts were fanned out per
-- recipient and the policy collapsed to `recipient_id = current_profile_id()`.
-- It did not touch WHICH COLUMNS of that row they may write, and
-- `authenticated` held table-wide UPDATE on all eleven.
--
-- MEASURED LIVE. A recipient PATCHed their own notification and successfully
-- rewrote SEVEN of the eight columns tried:
--
--   title, body, target_href, recipient_role, school_id, category, created_at
--
-- What that buys an attacker is not "editing their own inbox". `target_href`
-- is followed by markNotificationReadAndGo, so a recipient could point their
-- own notification anywhere in the app and change what the row says it is.
-- `school_id` and `recipient_role` are provenance the admin surfaces read.
-- `created_at` reorders the feed. None of it is data the recipient authored.
--
-- `recipient_id` was the one that held — and only incidentally: the policy's
-- WITH CHECK requires `recipient_id = current_profile_id()`, so reassigning the
-- row away from yourself fails that re-check. A column protected as a side
-- effect of a row predicate is not a column that is protected.
--
-- THE FIX is a column-level grant, the same instrument round 3 used for review
-- and post provenance (D-030): revoke table UPDATE, then grant UPDATE on
-- exactly `is_read`. The database refuses the column, so there is no policy
-- expression to reason about and no side effect to mistake for enforcement.
--
-- RLS is unchanged and still does its job: the row must still be the caller's.
-- Column privileges say WHAT may be written, policies say WHICH ROW — both are
-- needed, and neither substitutes for the other.
--
-- service_role keeps full UPDATE: the notification chokepoint runs there, and
-- `markNotificationReadAndGo` reads `target_href` but never writes it.
--
-- Preconditions: user_notifications exists with an is_read column.
-- Postconditions: no client role holds table-wide UPDATE; `authenticated` holds
-- UPDATE on exactly one column, `is_read`; SELECT is unaffected.
-- Rollback: re-grant table UPDATE — and the seven columns above become
-- rewritable again.

begin;

do $$
begin
  if to_regclass('public.user_notifications') is null then
    raise exception 'precondition failed: public.user_notifications is missing';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'user_notifications' and column_name = 'is_read'
  ) then
    raise exception 'precondition failed: user_notifications.is_read is missing';
  end if;
end $$;

-- Revoke FIRST. A column grant does not narrow an existing table grant; both
-- would simply coexist and the table grant would win.
revoke update on public.user_notifications from anon, authenticated;
grant update (is_read) on public.user_notifications to authenticated;

do $$
declare
  extra text;
begin
  -- Any column other than is_read that authenticated can still UPDATE.
  select string_agg(c.column_name, ', ') into extra
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name = 'user_notifications'
    and c.column_name <> 'is_read'
    and has_column_privilege('authenticated', 'public.user_notifications', c.column_name, 'UPDATE');
  if extra is not null then
    raise exception 'postcondition failed: authenticated can still UPDATE: %', extra;
  end if;

  if not has_column_privilege('authenticated', 'public.user_notifications', 'is_read', 'UPDATE') then
    raise exception 'postcondition failed: authenticated cannot mark notifications read; the app would break';
  end if;

  if has_table_privilege('anon', 'public.user_notifications', 'UPDATE') then
    raise exception 'postcondition failed: anon can UPDATE notifications';
  end if;

  -- Reading must survive: students still list their notifications.
  if not has_table_privilege('authenticated', 'public.user_notifications', 'SELECT') then
    raise exception 'postcondition failed: authenticated lost SELECT on user_notifications';
  end if;

  -- And the server-side writer must keep working.
  if not has_table_privilege('service_role', 'public.user_notifications', 'UPDATE') then
    raise exception 'postcondition failed: service_role lost UPDATE';
  end if;
end $$;

commit;
