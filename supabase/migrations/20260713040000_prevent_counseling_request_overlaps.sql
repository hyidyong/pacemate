begin;

do $$
begin
  if to_regclass('public.counseling_requests') is null then
    raise exception 'public.counseling_requests is required';
  end if;

  if not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'counseling_requests'
      and c.relrowsecurity
  ) then
    raise exception 'RLS must be enabled on public.counseling_requests';
  end if;

  if exists (
    select 1
    from public.counseling_requests a
    join public.counseling_requests b
      on a.id < b.id
     and a.professor_id = b.professor_id
     and a.status in ('pending', 'approved')
     and b.status in ('pending', 'approved')
     and tstzrange(a.requested_start, a.requested_end, '[)')
       && tstzrange(b.requested_start, b.requested_end, '[)')
  ) then
    raise exception 'active counseling request overlaps must be resolved first';
  end if;

  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.counseling_requests'::regclass
      and conname = 'counseling_requests_no_active_overlap'
  ) then
    raise exception 'counseling_requests_no_active_overlap already exists';
  end if;
end
$$;

-- UUID equality in a GiST exclusion constraint requires btree_gist. The
-- exclusion constraint is the database-level race-condition guard; an
-- application conflict check alone cannot make concurrent inserts safe.
create extension if not exists btree_gist with schema extensions;

alter table public.counseling_requests
  add constraint counseling_requests_no_active_overlap
  exclude using gist (
    professor_id with =,
    tstzrange(requested_start, requested_end, '[)') with &&
  )
  where (status in ('pending', 'approved'));

do $$
declare
  constraint_definition text;
begin
  select pg_get_constraintdef(oid)
    into constraint_definition
  from pg_constraint
  where conrelid = 'public.counseling_requests'::regclass
    and conname = 'counseling_requests_no_active_overlap'
    and contype = 'x';

  if constraint_definition is null
     or constraint_definition not ilike '%professor_id WITH =%'
     or constraint_definition not ilike '%tstzrange(requested_start, requested_end, ''[)''::text) WITH &&%'
     or constraint_definition not ilike '%status%pending%approved%' then
    raise exception 'counseling overlap exclusion constraint was not created as expected';
  end if;

  if not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'counseling_requests'
      and c.relrowsecurity
  ) then
    raise exception 'RLS was unexpectedly disabled on public.counseling_requests';
  end if;
end
$$;

commit;
