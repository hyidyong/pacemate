-- Stage 6 (multi-tenancy) M7: relax user_notifications.school_id back to
-- NULLABLE. Rationale discovered during implementation: several notification
-- writers are ungated actions that can run with a null acting profile
-- (support, roadmap-feedback, admin-approval — Stage 9 territory), so a hard
-- NOT NULL would silently break their (gracefully-degraded) notifications.
--
-- The column stays backfilled + indexed. The notification service stamps
-- school_id best-effort (explicit tenant, else derived from the recipient's
-- profile); a legacy/ungated writer may leave it NULL. Completing exhaustive
-- write-side tenant coverage + NOT NULL + tenant-scoped notification RLS is
-- folded into the Stage 9 notification/RLS overhaul (the anon SELECT policy on
-- user_notifications means read-side isolation is not fully enforceable at the
-- DB until then regardless). The concrete cross-tenant WRITE leak — the admin
-- broadcast fanning to every university — is closed in app code this stage.
begin;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'user_notifications'
      and column_name = 'school_id'
  ) then
    raise exception 'user_notifications.school_id must exist (run M3 first)';
  end if;
end
$$;

alter table public.user_notifications
  alter column school_id drop not null;

commit;
