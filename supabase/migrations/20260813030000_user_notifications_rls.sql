-- Stage 8 review round 3, finding 3 — close the user_notifications RLS bypass.
--
-- The Stage 8 application predicate (services/notifications.ownership.ts) is
-- correct but was decoration: the live policies were effectively
-- `using (target_href <> '')`, i.e. every row readable and updatable by anon
-- and authenticated. Verified before this migration: with ONLY the public
-- publishable key and no authentication at all, a plain PostgREST GET returned
-- all 131 notification rows including their titles.
--
-- Scope is deliberately ONE TABLE. This is not the Stage 9 RLS project
-- (KI-007/011/014/019); no other table's policies are touched.
--
-- Decisions encoded here, matching the application predicate exactly so the two
-- layers cannot drift:
--
--   * own direct notification  -> recipient_id names the caller's profile.
--     Matched regardless of school_id: a row addressed to a specific profile
--     cannot name anyone else, and this keeps notifications reachable even
--     where the writer failed to stamp a tenant.
--   * same-tenant role broadcast -> recipient_id IS NULL, the role matches, and
--     school_id equals the caller's tenant.
--   * NULL school_id role broadcast -> matches NOTHING. Undirected legacy data
--     (D-018) is not a platform-global broadcast; a row that cannot be proven
--     to belong to the caller's tenant is not shown to them. Same fail-closed
--     stance as resolveTenantContext (D-021).
--
-- Identity mapping note: auth.uid() is auth.users.id, and the profile is found
-- through profiles.auth_user_id — NOT profiles.id. Comparing auth.uid() to
-- profiles.id is the pre-existing KI-007 defect and is deliberately not
-- repeated here.
--
-- INSERT is intentionally left alone: notifications are created through the
-- session client, which runs as `anon` for the sessionless /support flow, so
-- restricting it would break legitimate unauthenticated notification creation
-- (that flow's missing authorization is tracked separately in KI-021).

-- The old blanket policies.
drop policy if exists "demo read notifications" on public.user_notifications;
drop policy if exists "demo update notifications" on public.user_notifications;

-- Scoped to `authenticated` only. anon keeps its INSERT policy but, having no
-- SELECT/UPDATE policy, is denied by RLS default-deny — which is what closes
-- the publishable-key bypass above.
create policy "notifications readable by recipient or same-tenant role"
  on public.user_notifications
  for select
  to authenticated
  using (
    recipient_id = (select p.id from public.profiles p where p.auth_user_id = auth.uid())
    or (
      recipient_id is null
      and recipient_role = (select p.role from public.profiles p where p.auth_user_id = auth.uid())
      and school_id is not null
      and school_id = (select p.school_id from public.profiles p where p.auth_user_id = auth.uid())
    )
  );

-- USING bounds which rows may be updated; WITH CHECK repeats the predicate so a
-- caller cannot move a row into another tenant or re-address it to someone else
-- as part of the update.
create policy "notifications updatable by recipient or same-tenant role"
  on public.user_notifications
  for update
  to authenticated
  using (
    recipient_id = (select p.id from public.profiles p where p.auth_user_id = auth.uid())
    or (
      recipient_id is null
      and recipient_role = (select p.role from public.profiles p where p.auth_user_id = auth.uid())
      and school_id is not null
      and school_id = (select p.school_id from public.profiles p where p.auth_user_id = auth.uid())
    )
  )
  with check (
    recipient_id = (select p.id from public.profiles p where p.auth_user_id = auth.uid())
    or (
      recipient_id is null
      and recipient_role = (select p.role from public.profiles p where p.auth_user_id = auth.uid())
      and school_id is not null
      and school_id = (select p.school_id from public.profiles p where p.auth_user_id = auth.uid())
    )
  );

-- The scalar subqueries are uncorrelated with the outer row, so Postgres
-- evaluates them once per statement (InitPlan) rather than per row; the unique
-- index on profiles.auth_user_id (20260712183855) serves them.
