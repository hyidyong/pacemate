-- Stage 9 (Codex review round) — least privilege on the one table anon can reach.
--
-- `schools` is the single table Stage 9 deliberately leaves readable without a
-- session: it is the tenant registry a caller needs before it has any identity
-- (SSO slug resolution, login). Reading it is intended. Everything else was not.
--
-- Live grants before this migration, taken from the generated security snapshot:
--
--   anon           DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   authenticated  DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--
-- RLS does block those writes today — the only policy on the table is a SELECT
-- policy, and a write with no permissive policy is denied. So this is not an
-- open hole. It is a grant surface far wider than the intent, resting entirely
-- on the continued absence of a permissive write policy: the day somebody adds
-- one for a legitimate reason, TRUNCATE and DELETE come along with it.
--
-- Reduced to what each role actually needs. TRUNCATE in particular has no
-- business being reachable by a browser role on the tenant registry.
--
-- Preconditions: the anon read policy exists (this must not break login).
-- Postconditions: anon and authenticated hold SELECT and nothing else;
-- service_role retains write access for provisioning.
-- Rollback: re-grant, though there is no reason to.

begin;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'schools' and cmd = 'SELECT'
  ) then
    raise exception 'precondition failed: schools has no SELECT policy; revoking would break login';
  end if;
end
$$;

revoke all on public.schools from anon, authenticated;
grant select on public.schools to anon, authenticated;
grant select, insert, update, delete on public.schools to service_role;

do $$
declare
  offending text;
begin
  select string_agg(grantee || ':' || privilege_type, ', ')
    into offending
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name = 'schools'
    and grantee in ('anon', 'authenticated')
    and privilege_type <> 'SELECT';
  if offending is not null then
    raise exception 'postcondition failed: schools still over-granted: %', offending;
  end if;

  -- The legitimate path must survive: the tenant registry stays readable.
  if not has_table_privilege('anon', 'public.schools', 'select') then
    raise exception 'postcondition failed: anon lost SELECT on schools; pre-login tenant resolution would break';
  end if;
  if not has_table_privilege('service_role', 'public.schools', 'insert') then
    raise exception 'postcondition failed: service_role cannot provision a tenant';
  end if;
end
$$;

commit;
