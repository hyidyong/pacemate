-- Stage 9 (Codex round 4, finding 6) — TRUNCATE is not subject to RLS, so no
-- client role may hold it.
--
-- FOUND WHILE VERIFYING FINDING 6. The review asked whether an unauthorized
-- student can delete an official `course_notice`. The DELETE policy says no:
--
--   authors delete own posts:
--     author_id = current_profile_id() AND school_id = current_school_id()
--
-- and round 3's F3 means no student can be the AUTHOR of a course_notice, so
-- no student's DELETE can ever match one. That part held. But reading the live
-- privileges to confirm it turned up something the policy cannot help with:
--
--   posts  authenticated  DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE
--
-- TRUNCATE IS NOT SUBJECT TO ROW LEVEL SECURITY. It also fires no row triggers.
-- A role holding it can empty the entire table across every tenant in one
-- statement, and every DELETE policy in this schema becomes decorative.
-- Measured live: `authenticated` effectively held TRUNCATE on 31 of 54 public
-- tables — the Supabase default grant pattern, never narrowed.
--
-- HOW REACHABLE IS IT? Not through PostgREST, which has no TRUNCATE verb. That
-- is why this is least privilege rather than an exploit report, and it is
-- recorded that way. But "the current API happens not to expose the verb" is a
-- property of PostgREST's feature set, not a security control, and it is the
-- only thing standing between an authenticated session and mass deletion.
--
-- REFERENCES and TRIGGER go too. Neither is reachable through the Data API and
-- neither is needed by a client: REFERENCES exists to create foreign keys and
-- TRIGGER to attach functions to a table, both of which are migration work
-- performed as the owner. TRIGGER in particular lets a role attach code to
-- someone else's writes, which is a privilege-escalation shape worth removing
-- while we are here.
--
-- SELECT/INSERT/UPDATE/DELETE are untouched. Those ARE the Data API surface and
-- they are governed by RLS; this migration changes nothing a policy decides.
--
-- Preconditions: none beyond the schema existing.
-- Postconditions: neither anon nor authenticated holds TRUNCATE, REFERENCES or
-- TRIGGER on ANY table in public, computed with has_table_privilege so a
-- privilege arriving through PUBLIC or role inheritance is caught too.
-- Rollback: re-grant, but mass deletion becomes possible again.

begin;

do $$
declare
  rec record;
begin
  for rec in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
  loop
    execute format(
      'revoke truncate, references, trigger on public.%I from anon, authenticated',
      rec.relname
    );
  end loop;
end $$;

-- Future tables must not reappear with the same defaults.
alter default privileges in schema public
  revoke truncate, references, trigger on tables from anon, authenticated;

do $$
declare
  offenders text;
begin
  select string_agg(format('%s:%s:%s', r.rolname, c.relname, p.priv), ', ')
    into offenders
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join (values ('anon'), ('authenticated')) as r(rolname)
  cross join (values ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) as p(priv)
  where n.nspname = 'public'
    and c.relkind = 'r'
    and has_table_privilege(r.rolname, c.oid, p.priv);

  if offenders is not null then
    raise exception 'postcondition failed: client roles still hold destructive privileges: %', offenders;
  end if;
end $$;

-- The Data API surface must SURVIVE this. A least-privilege pass that also
-- removes the privileges the application depends on is not a fix.
do $$
begin
  if not has_table_privilege('authenticated', 'public.posts', 'SELECT')
     or not has_table_privilege('authenticated', 'public.posts', 'INSERT')
     or not has_table_privilege('authenticated', 'public.posts', 'DELETE') then
    raise exception 'postcondition failed: authenticated lost a privilege the app needs on posts';
  end if;
  if not has_table_privilege('anon', 'public.schools', 'SELECT') then
    raise exception 'postcondition failed: anon lost SELECT on schools (the pre-login tenant registry)';
  end if;
end $$;

commit;
