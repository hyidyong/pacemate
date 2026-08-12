-- Stage 9 (Codex review round) — the roadmap revision workflow gets a tenant.
--
-- `roadmap_revision_requests` had no tenant column at all. Everything about it
-- was therefore global:
--
--   creation   — no tenant recorded, so nothing downstream could scope it
--   reads      — the Stage 9 SELECT policy allowed any 'assistant' | 'admin' |
--                'professor' of ANY university to read every workflow row
--   approval   — updateRoadmapRevisionStatus checked ROLE only, so a tenant B
--                admin holding a tenant A request's UUID could approve it
--   overlay    — getApprovedRoadmapCourses merged every approved patch into the
--                rendered roadmap with no tenant filter
--
-- The attack path the review describes therefore held end to end: A's staff
-- create a request, B's admin approves it, and the patch enters the roadmap
-- overlay. Approving is not a harmless status change — the patch is merged into
-- what every student reads.
--
-- Authorization for an admin action must be identity + role + TENANT OWNERSHIP,
-- not role alone.
--
-- Backfill: from the proposer's profile where present, else from the referenced
-- course, else the single existing tenant. Asserted complete afterwards.
--
-- Preconditions: the identity helpers exist; exactly one tenant, or every row
-- resolvable.
-- Postconditions: school_id is populated and NOT NULL; the SELECT policy carries
-- a tenant term; no client role may write.
-- Rollback: drop the column and re-create the policy from 20260814010000.

begin;

do $$
begin
  if to_regprocedure('app_private.current_school_id()') is null then
    raise exception 'precondition failed: run 20260814000000_stage9_identity_helpers first';
  end if;
end
$$;

alter table public.roadmap_revision_requests
  add column if not exists school_id uuid references public.schools(id) on delete restrict;

-- 1. the proposer's tenant is the authoritative answer
update public.roadmap_revision_requests r
   set school_id = p.school_id
  from public.profiles p
 where r.school_id is null
   and p.id = r.proposed_by;

-- 2. otherwise the referenced course's tenant. `course_id` here is TEXT, not a
-- uuid FK — the workflow stores denormalized target strings (KI-019), which is
-- precisely why it had no tenant to derive from. Compare as text.
update public.roadmap_revision_requests r
   set school_id = c.school_id
  from public.courses c
 where r.school_id is null
   and c.id::text = r.course_id;

-- 3. otherwise, only when the platform has exactly one tenant, that tenant
do $$
declare
  tenant_count bigint;
  only_tenant uuid;
begin
  select count(*) into tenant_count from public.schools;
  if tenant_count = 1 then
    select id into only_tenant from public.schools limit 1;
    update public.roadmap_revision_requests
       set school_id = only_tenant
     where school_id is null;
  end if;
end
$$;

do $$
declare
  orphans bigint;
begin
  select count(*) into orphans from public.roadmap_revision_requests where school_id is null;
  if orphans > 0 then
    raise exception
      'precondition failed: % roadmap_revision_requests row(s) have no resolvable tenant; assign them before tightening',
      orphans;
  end if;
end
$$;

alter table public.roadmap_revision_requests
  alter column school_id set not null;

create index if not exists roadmap_revision_requests_school_created_idx
  on public.roadmap_revision_requests (school_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Reads: same tenant only. An APPROVED revision is published curriculum content
-- for the university that approved it — not for every university.
-- ---------------------------------------------------------------------------
drop policy if exists "published revisions and own workflow rows are readable"
  on public.roadmap_revision_requests;
drop policy if exists "staff and proposers read roadmap revision requests"
  on public.roadmap_revision_requests;

create policy "tenant reads its own roadmap revision requests"
  on public.roadmap_revision_requests for select to authenticated
  using (
    school_id = app_private.current_school_id()
    and (
      status = 'approved'
      or proposed_by = app_private.current_profile_id()
      or app_private.current_user_role() in ('assistant', 'admin', 'professor')
    )
  );

-- Writes stay server-only: creation and approval both run under the service
-- role after a server-side tenant + role check.
revoke insert, update, delete on public.roadmap_revision_requests from authenticated, anon;
grant select on public.roadmap_revision_requests to authenticated;
grant select, insert, update, delete on public.roadmap_revision_requests to service_role;

do $$
declare
  offending text;
begin
  if exists (select 1 from public.roadmap_revision_requests where school_id is null) then
    raise exception 'postcondition failed: unscoped roadmap revision rows remain';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'roadmap_revision_requests'
      and cmd = 'SELECT'
      and qual like '%current_school_id%'
  ) then
    raise exception 'postcondition failed: the read policy has no tenant term';
  end if;

  select string_agg(grantee || ':' || privilege_type, ', ')
    into offending
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name = 'roadmap_revision_requests'
    and grantee in ('anon', 'authenticated')
    and privilege_type in ('INSERT', 'UPDATE', 'DELETE');
  if offending is not null then
    raise exception 'postcondition failed: a client role can write the workflow: %', offending;
  end if;

  if not has_table_privilege('service_role', 'public.roadmap_revision_requests', 'update') then
    raise exception 'postcondition failed: service_role cannot run the approval';
  end if;
end
$$;

commit;
