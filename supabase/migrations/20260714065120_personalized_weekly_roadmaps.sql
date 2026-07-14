-- Persisted professor inputs and student-specific, validated roadmap output.
-- Access is server-mediated while the demo cookie session is in use.

begin;

create table if not exists public.course_roadmap_personalization_sources (
  id uuid primary key default gen_random_uuid(),
  offering_id uuid not null unique references public.course_offerings(id) on delete cascade,
  professor_id uuid not null references public.professors(id) on delete restrict,
  foundation_knowledge text not null default '',
  focus_keywords jsonb not null default '[]'::jsonb,
  professor_notes text not null default '',
  source_version integer not null default 1 check (source_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.student_personalized_weekly_roadmaps (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  offering_id uuid not null references public.course_offerings(id) on delete cascade,
  week_number integer not null check (week_number between 1 and 15),
  baseline_title text not null,
  baseline_topic text not null,
  baseline_content text not null,
  personalized_goal text not null,
  learning_activities jsonb not null default '[]'::jsonb,
  review_guide text not null,
  source_version integer not null check (source_version > 0),
  onboarding_hash text not null,
  input_hash text not null,
  generation_status text not null check (generation_status in ('ready', 'fallback', 'failed')),
  generated_by_ai boolean not null default false,
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint student_personalized_weekly_roadmaps_identity_key unique (student_id, offering_id, week_number)
);

create index if not exists course_roadmap_personalization_sources_offering_idx
  on public.course_roadmap_personalization_sources(offering_id);
create index if not exists student_personalized_weekly_roadmaps_lookup_idx
  on public.student_personalized_weekly_roadmaps(student_id, offering_id, source_version);

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'course_roadmap_personalization_sources_set_updated_at' and not tgisinternal) then
    create trigger course_roadmap_personalization_sources_set_updated_at
    before update on public.course_roadmap_personalization_sources
    for each row execute function public.set_updated_at();
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'student_personalized_weekly_roadmaps_set_updated_at' and not tgisinternal) then
    create trigger student_personalized_weekly_roadmaps_set_updated_at
    before update on public.student_personalized_weekly_roadmaps
    for each row execute function public.set_updated_at();
  end if;
end
$$;

alter table public.course_roadmap_personalization_sources enable row level security;
alter table public.student_personalized_weekly_roadmaps enable row level security;

revoke all on public.course_roadmap_personalization_sources,
  public.student_personalized_weekly_roadmaps
  from public, anon, authenticated;

commit;
