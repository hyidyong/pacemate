-- Persist strict syllabus-derived course study guides per student and offering.
-- Access is server-mediated while the application uses its demo cookie session.

begin;

create table public.student_course_study_guides (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  offering_id uuid not null references public.course_offerings(id) on delete cascade,
  guide_json jsonb not null,
  syllabus_hash text not null,
  personalization_hash text not null,
  generation_status text not null check (generation_status in ('ready', 'fallback')),
  generated_by_ai boolean not null default false,
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint student_course_study_guides_identity_key unique (student_id, offering_id),
  constraint student_course_study_guides_json_object_check
    check (jsonb_typeof(guide_json) = 'object')
);

create index student_course_study_guides_offering_updated_idx
  on public.student_course_study_guides(offering_id, updated_at desc);

create trigger student_course_study_guides_set_updated_at
before update on public.student_course_study_guides
for each row execute function public.set_updated_at();

alter table public.student_course_study_guides enable row level security;

revoke all on public.student_course_study_guides from public, anon, authenticated;
grant select, insert, update, delete on public.student_course_study_guides to service_role;

do $$
begin
  if not exists (
    select 1
    from pg_class c
    where c.oid = 'public.student_course_study_guides'::regclass
      and c.relrowsecurity
  ) then
    raise exception 'student_course_study_guides must have row level security enabled';
  end if;

  if exists (
    select 1
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name = 'student_course_study_guides'
      and grantee in ('anon', 'authenticated', 'PUBLIC')
  ) then
    raise exception 'student_course_study_guides must not be directly exposed to client roles';
  end if;

  if not exists (
    select 1
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name = 'student_course_study_guides'
      and grantee = 'service_role'
      and privilege_type = 'SELECT'
  ) then
    raise exception 'service_role requires explicit student_course_study_guides access';
  end if;
end
$$;

commit;
