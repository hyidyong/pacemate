begin;

alter table public.user_notifications
  add column if not exists target_group text not null default 'ALL';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'user_notifications_target_group_check'
      and conrelid = 'public.user_notifications'::regclass
  ) then
    alter table public.user_notifications
      add constraint user_notifications_target_group_check
      check (target_group in ('ALL', 'STUDENT', 'PROFESSOR'));
  end if;
end
$$;

create index if not exists user_notifications_target_group_created_idx
  on public.user_notifications(target_group, created_at desc);

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'user_notifications'
    ) then
    alter publication supabase_realtime add table public.user_notifications;
  end if;
end
$$;

commit;
