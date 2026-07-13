begin;

do $$
begin
  if to_regclass('public.professors') is null or to_regclass('public.profiles') is null then
    raise exception 'Expected public.professors and public.profiles tables to exist';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'professors'
      and column_name in ('profile_id', 'office', 'email', 'bio')
    group by table_schema, table_name
    having count(*) = 4
  ) then
    raise exception 'Expected professor profile columns are missing';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'auth_user_id'
  ) then
    raise exception 'Expected profiles.auth_user_id to exist';
  end if;

  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'professors'
      and policyname = 'professors update own profile'
  ) then
    raise exception 'Policy professors update own profile already exists';
  end if;
end;
$$;

revoke update on public.professors from anon, authenticated;
grant update (office, email, bio) on public.professors to authenticated;

create policy "professors update own profile"
on public.professors
for update
to authenticated
using (
  exists (
    select 1
    from public.profiles profile
    where profile.id = professors.profile_id
      and profile.auth_user_id = (select auth.uid())
      and profile.role = 'professor'
  )
)
with check (
  exists (
    select 1
    from public.profiles profile
    where profile.id = professors.profile_id
      and profile.auth_user_id = (select auth.uid())
      and profile.role = 'professor'
  )
);

commit;
