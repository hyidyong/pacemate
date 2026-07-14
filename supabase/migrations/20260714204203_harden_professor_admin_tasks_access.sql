begin;

alter table public.professor_admin_tasks enable row level security;

revoke all on public.professor_admin_tasks from anon;
revoke all on public.professor_admin_tasks from authenticated;
grant select, insert, delete on public.professor_admin_tasks to authenticated;

drop policy if exists "demo anon manage professor admin tasks" on public.professor_admin_tasks;
drop policy if exists "demo auth manage professor admin tasks" on public.professor_admin_tasks;

-- Counseling availability needs signed-in users to read task blocks, but only
-- the owning professor may create or remove one.
create policy "authenticated read professor admin tasks"
  on public.professor_admin_tasks for select to authenticated
  using (true);

create policy "professors insert own admin tasks"
  on public.professor_admin_tasks for insert to authenticated
  with check (exists (
    select 1
    from public.professors pr
    join public.profiles p on p.id = pr.profile_id
    where pr.id = professor_admin_tasks.professor_id
      and p.auth_user_id = (select auth.uid())
      and p.role = 'professor'
  ));

create policy "professors delete own admin tasks"
  on public.professor_admin_tasks for delete to authenticated
  using (exists (
    select 1
    from public.professors pr
    join public.profiles p on p.id = pr.profile_id
    where pr.id = professor_admin_tasks.professor_id
      and p.auth_user_id = (select auth.uid())
      and p.role = 'professor'
  ));

commit;
