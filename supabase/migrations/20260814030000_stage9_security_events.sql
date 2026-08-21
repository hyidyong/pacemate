-- Stage 9 — a durable, append-oriented security audit trail.
--
-- Operational logging and an audit trail are different requirements. Stage 8
-- built the first (structured JSON to stdout, D-023). Everything security-
-- sensitive in this application still terminates there: SSO account linking and
-- JIT provisioning, SSO and password login denials, tenant-wide admin
-- broadcasts. Once the platform's log window closes, "when did external subject
-- X become profile Y, and under which provider policy" is unanswerable.
--
-- Two options were weighed (AUDIT_RECOVERY_DESIGN.md §3):
--   A. keep platform logs only — zero build cost, but retention is outside our
--      control, the events cannot be queried by tenant, and there is no record
--      at all for the unlogged admin actions;
--   B. a minimal append-oriented table written through the two logging
--      chokepoints that already exist.
-- B was chosen because both chokepoints are single functions whose output shape
-- is already frozen by tests, so no call site changes.
--
-- SCOPE DISCIPLINE. This is NOT a request log. Only events that change identity,
-- privilege, tenant configuration or correctness-critical state are written, so
-- the table grows with administrative activity rather than with traffic.
--
-- NOT CLAIMED: this is not tamper-proof. There is no hash chain and no
-- signature. A compromised service-role key can write false rows; it simply
-- cannot quietly edit or delete true ones through any client role, because no
-- client role has any privilege here at all.

begin;

create table if not exists public.security_events (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  -- e.g. sso_jit_provisioned, auth.login_denied, admin.broadcast_sent
  event text not null check (event <> ''),
  outcome text not null check (outcome in ('ok', 'denied', 'conflict', 'user_error', 'fault')),
  -- Who acted. Nullable: a denied login has no established actor.
  actor_profile_id uuid references public.profiles(id) on delete set null,
  actor_role public.user_role,
  school_id uuid references public.schools(id) on delete set null,
  -- What was acted upon, as an opaque identifier — never a name or an email.
  subject_type text,
  subject_id text,
  -- Correlation id minted by middleware (Stage 8), so a durable row can be
  -- joined to the operational log line it came from.
  request_id text,
  -- A short, allowlisted classification string. NEVER a raw error, never a
  -- Postgres detail/hint, never free-form user content. Bounded so the column
  -- cannot become an accidental PII sink.
  detail text check (detail is null or length(detail) <= 200)
);

create index if not exists security_events_occurred_at_idx
  on public.security_events (occurred_at desc);
create index if not exists security_events_school_occurred_idx
  on public.security_events (school_id, occurred_at desc);
create index if not exists security_events_event_occurred_idx
  on public.security_events (event, occurred_at desc);

alter table public.security_events enable row level security;

-- No client role may write, and no client role may ever UPDATE or DELETE. The
-- application writes through the service role only. This is what "append
-- oriented" means here: the ability to rewrite history is not granted to
-- anything the browser can reach.
revoke all on public.security_events from public, anon, authenticated;
grant select on public.security_events to authenticated;

-- Privileged read: a tenant admin sees their own tenant's events and nothing
-- else. There is no policy for INSERT/UPDATE/DELETE, so those are denied for
-- every role that is not BYPASSRLS.
drop policy if exists "tenant admins read their own security events" on public.security_events;
create policy "tenant admins read their own security events"
  on public.security_events for select to authenticated
  using (
    app_private.current_user_role() = 'admin'
    and school_id is not null
    and school_id = app_private.current_school_id()
  );

do $$
declare
  bad text;
begin
  if to_regclass('public.security_events') is null then
    raise exception 'postcondition failed: security_events was not created';
  end if;

  select string_agg(grantee || ':' || privilege_type, ', ')
    into bad
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name = 'security_events'
    and grantee in ('anon', 'authenticated', 'PUBLIC')
    and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE');
  if bad is not null then
    raise exception 'postcondition failed: client roles can mutate the audit trail: %', bad;
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'security_events' and cmd <> 'SELECT'
  ) then
    raise exception 'postcondition failed: a non-SELECT policy exists on the audit trail';
  end if;
end
$$;

commit;
