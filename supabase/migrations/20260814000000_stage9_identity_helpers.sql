-- Stage 9 — a single, correct definition of "who is calling".
--
-- WHY THIS EXISTS
--
-- Almost every authenticated policy written before this migration compares
-- `auth.uid()` to a column that holds `profiles.id`:
--
--     using ((select auth.uid()) = student_id)      -- student_courses
--     using ((select auth.uid()) = profile_id)      -- student_profiles
--     using ((select auth.uid()) = id)              -- profiles UPDATE
--
-- `auth.uid()` is the GoTrue user id. `profiles.id` is a separate key; the two
-- were only ever joined through `profiles.auth_user_id`, added in
-- 20260712183855, which fixed exactly one policy and left the rest. Measured on
-- the live database before this migration: 27 profiles, of which 4 happen to
-- have `id = auth_user_id` and 19 have no auth user at all. So those predicates
-- match almost nobody, and the Stage 9 probe confirmed the consequence
-- empirically — a signed-in student could NOT read their own `student_profiles`
-- row (0 rows returned).
--
-- The application never noticed because the same tables also carried
-- `demo anon ... for all` policies, so the browser fell back to the `anon` role
-- and everything worked. Removing those anon policies (next migration) is only
-- safe once the authenticated predicates actually resolve, which is what this
-- migration provides.
--
-- WHY A PRIVATE SCHEMA
--
-- KI-011: `is_professor_of_offering` / `is_student_of_offering` are SECURITY
-- DEFINER functions sitting in `public`, so PostgREST publishes them as RPC
-- endpoints. They are moved here to a schema that is not in the exposed list,
-- and re-created with `search_path = ''` and fully-qualified names, which is
-- Supabase's own guidance and removes the mutable-search_path surface.
--
-- Preconditions asserted: profiles.auth_user_id exists.
-- Postconditions asserted: app_private is not exposed; anon holds no EXECUTE.
-- Rollback: drop schema app_private cascade, then re-run 20260812000000.

begin;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'auth_user_id'
  ) then
    raise exception 'precondition failed: public.profiles.auth_user_id is missing (20260712183855 not applied)';
  end if;
end
$$;

create schema if not exists app_private;

-- `authenticated` must be able to CALL these from inside a policy, but must not
-- be able to browse the schema. PostgREST only exposes schemas named in its
-- db-schemas setting (public, graphql_public), so app_private is unreachable
-- over HTTP regardless.
revoke all on schema app_private from public;
grant usage on schema app_private to authenticated, service_role;

-- The caller's profile row id, or null when the JWT maps to no profile.
create or replace function app_private.current_profile_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
  from public.profiles p
  where p.auth_user_id = (select auth.uid())
  limit 1;
$$;

create or replace function app_private.current_school_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.school_id
  from public.profiles p
  where p.auth_user_id = (select auth.uid())
  limit 1;
$$;

create or replace function app_private.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
  from public.profiles p
  where p.auth_user_id = (select auth.uid())
  limit 1;
$$;

-- The caller's professors.id when they are a professor, else null.
create or replace function app_private.current_professor_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select pr.id
  from public.professors pr
  join public.profiles p on p.id = pr.profile_id
  where p.auth_user_id = (select auth.uid())
    and p.role = 'professor'
  limit 1;
$$;

-- KI-011: relocated out of the PostgREST-exposed schema, search_path pinned to
-- empty. Behaviour is identical to the 20260812000000 definitions.
create or replace function app_private.is_professor_of_offering(p_offering_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.course_offerings offering
    join public.professors professor on professor.id = offering.professor_id
    join public.profiles professor_profile on professor_profile.id = professor.profile_id
    where offering.id = p_offering_id
      and professor_profile.auth_user_id = (select auth.uid())
      and professor_profile.role = 'professor'
  );
$$;

create or replace function app_private.is_student_of_offering(p_offering_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.student_weekly_progress swp
    join public.profiles p on p.id = swp.student_id
    where swp.offering_id = p_offering_id
      and p.auth_user_id = (select auth.uid())
      and p.role = 'student'
  );
$$;

revoke all on all functions in schema app_private from public, anon;
grant execute on all functions in schema app_private to authenticated, service_role;

-- Repoint the three policies that referenced the public copies, then remove
-- those copies so the RPC endpoints disappear.
drop policy if exists "students read own course offerings" on public.course_offerings;
create policy "students read own course offerings"
  on public.course_offerings for select to authenticated
  using (app_private.is_student_of_offering(id));

drop policy if exists "professors read own student course progress" on public.student_course_progress;
create policy "professors read own student course progress"
  on public.student_course_progress for select to authenticated
  using (app_private.is_professor_of_offering(offering_id));

drop policy if exists "professors read own weekly aggregate evidence" on public.student_weekly_progress;
create policy "professors read own weekly aggregate evidence"
  on public.student_weekly_progress for select to authenticated
  using (app_private.is_professor_of_offering(offering_id));

drop function if exists public.is_professor_of_offering(uuid);
drop function if exists public.is_student_of_offering(uuid);

do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('is_professor_of_offering', 'is_student_of_offering')
  ) then
    raise exception 'postcondition failed: SECURITY DEFINER helpers still exposed in public';
  end if;

  if has_schema_privilege('anon', 'app_private', 'usage') then
    raise exception 'postcondition failed: anon can use app_private';
  end if;

  if not has_function_privilege('authenticated', 'app_private.current_profile_id()', 'execute') then
    raise exception 'postcondition failed: authenticated cannot execute the identity helpers';
  end if;
end
$$;

commit;
