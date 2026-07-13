begin;

do $$
declare
  item record;
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'posts' and column_name = 'community_type'
  ) then
    raise exception 'posts.community_type already exists';
  end if;

  for item in select unnest(array['posts', 'comments', 'post_reactions', 'reports']) as table_name
  loop
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = item.table_name and c.relrowsecurity
    ) then
      raise exception 'RLS must be enabled on public.%', item.table_name;
    end if;
  end loop;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name = 'auth_user_id' and udt_name = 'uuid'
  ) then
    raise exception 'profiles.auth_user_id is required';
  end if;
end
$$;

alter table public.posts add column community_type text;
alter table public.posts add constraint posts_community_type_check
  check (community_type in ('student', 'professor'));

update public.posts posts
set community_type = 'student'
from public.profiles p
where p.id = posts.author_id and p.role = 'student';

update public.posts posts
set community_type = 'professor'
from public.profiles p
where p.id = posts.author_id and p.role = 'professor';

do $$
begin
  if exists (
    select 1
    from public.posts posts
    join public.profiles p on p.id = posts.author_id
    where p.role in ('student', 'professor')
      and posts.community_type is distinct from p.role::text
  ) then
    raise exception 'A resolvable post was not backfilled to its author community';
  end if;
end
$$;

create index posts_community_type_status_created_idx
  on public.posts (community_type, status, created_at desc);

drop policy "public read active posts" on public.posts;
drop policy "demo anon create posts" on public.posts;
drop policy "demo anon update own-ish posts" on public.posts;
drop policy "users create posts" on public.posts;
drop policy "authors update own posts" on public.posts;

create policy "users read matching community posts"
  on public.posts for select to authenticated
  using (
    status = 'active'
    and exists (
      select 1 from public.profiles p
      where p.auth_user_id = (select auth.uid())
        and ((p.role = 'student' and posts.community_type = 'student')
          or (p.role = 'professor' and posts.community_type = 'professor'))
    )
  );

create policy "users create posts"
  on public.posts for insert to authenticated
  with check (
    status = 'active'
    and exists (
      select 1 from public.profiles p
      where p.id = posts.author_id
        and p.auth_user_id = (select auth.uid())
        and ((p.role = 'student' and posts.community_type = 'student')
          or (p.role = 'professor' and posts.community_type = 'professor'))
    )
  );

create policy "authors update own posts"
  on public.posts for update to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = posts.author_id and p.auth_user_id = (select auth.uid())
        and ((p.role = 'student' and posts.community_type = 'student')
          or (p.role = 'professor' and posts.community_type = 'professor'))
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = posts.author_id and p.auth_user_id = (select auth.uid())
        and ((p.role = 'student' and posts.community_type = 'student')
          or (p.role = 'professor' and posts.community_type = 'professor'))
    )
  );

create policy "authors delete own posts"
  on public.posts for delete to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = posts.author_id and p.auth_user_id = (select auth.uid())
        and ((p.role = 'student' and posts.community_type = 'student')
          or (p.role = 'professor' and posts.community_type = 'professor'))
    )
  );

drop policy "public read active comments" on public.comments;
drop policy "users create comments" on public.comments;
drop policy "authors update own comments" on public.comments;

create policy "users read matching community comments"
  on public.comments for select to authenticated
  using (
    status = 'active' and exists (
      select 1 from public.posts
      join public.profiles p on p.auth_user_id = (select auth.uid())
      where posts.id = comments.post_id
        and ((p.role = 'student' and posts.community_type = 'student')
          or (p.role = 'professor' and posts.community_type = 'professor'))
    )
  );

create policy "users create comments"
  on public.comments for insert to authenticated
  with check (
    status = 'active' and exists (
      select 1 from public.posts
      join public.profiles p on p.id = comments.author_id
      where posts.id = comments.post_id
        and p.auth_user_id = (select auth.uid())
        and ((p.role = 'student' and posts.community_type = 'student')
          or (p.role = 'professor' and posts.community_type = 'professor'))
    )
  );

create policy "authors update own comments"
  on public.comments for update to authenticated
  using (exists (
    select 1 from public.posts join public.profiles p on p.id = comments.author_id
    where posts.id = comments.post_id and p.auth_user_id = (select auth.uid())
      and ((p.role = 'student' and posts.community_type = 'student')
        or (p.role = 'professor' and posts.community_type = 'professor'))
  ))
  with check (exists (
    select 1 from public.posts join public.profiles p on p.id = comments.author_id
    where posts.id = comments.post_id and p.auth_user_id = (select auth.uid())
      and ((p.role = 'student' and posts.community_type = 'student')
        or (p.role = 'professor' and posts.community_type = 'professor'))
  ));

create policy "authors delete own comments"
  on public.comments for delete to authenticated
  using (exists (
    select 1 from public.posts join public.profiles p on p.id = comments.author_id
    where posts.id = comments.post_id and p.auth_user_id = (select auth.uid())
      and ((p.role = 'student' and posts.community_type = 'student')
        or (p.role = 'professor' and posts.community_type = 'professor'))
  ));

drop policy "demo anon manage reactions" on public.post_reactions;
drop policy "users manage own reactions" on public.post_reactions;

create policy "users read matching community reactions"
  on public.post_reactions for select to authenticated
  using (exists (
    select 1 from public.posts join public.profiles p on p.auth_user_id = (select auth.uid())
    where posts.id = post_reactions.post_id
      and ((p.role = 'student' and posts.community_type = 'student')
        or (p.role = 'professor' and posts.community_type = 'professor'))
  ));

create policy "users create own community reactions"
  on public.post_reactions for insert to authenticated
  with check (exists (
    select 1 from public.posts join public.profiles p on p.id = post_reactions.user_id
    where posts.id = post_reactions.post_id and p.auth_user_id = (select auth.uid())
      and ((p.role = 'student' and posts.community_type = 'student')
        or (p.role = 'professor' and posts.community_type = 'professor'))
  ));

create policy "users delete own community reactions"
  on public.post_reactions for delete to authenticated
  using (exists (
    select 1 from public.posts join public.profiles p on p.id = post_reactions.user_id
    where posts.id = post_reactions.post_id and p.auth_user_id = (select auth.uid())
      and ((p.role = 'student' and posts.community_type = 'student')
        or (p.role = 'professor' and posts.community_type = 'professor'))
  ));

drop policy "users create reports" on public.reports;
drop policy "users read own reports" on public.reports;

create policy "users create community reports"
  on public.reports for insert to authenticated
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = reports.reporter_id and p.auth_user_id = (select auth.uid())
        and p.role in ('student', 'professor')
    )
    and (
      (target_type = 'post' and exists (
        select 1 from public.posts join public.profiles p on p.auth_user_id = (select auth.uid())
        where posts.id = reports.target_id
          and ((p.role = 'student' and posts.community_type = 'student')
            or (p.role = 'professor' and posts.community_type = 'professor'))
      ))
      or (target_type = 'comment' and exists (
        select 1 from public.comments join public.posts on posts.id = comments.post_id
        join public.profiles p on p.auth_user_id = (select auth.uid())
        where comments.id = reports.target_id
          and ((p.role = 'student' and posts.community_type = 'student')
            or (p.role = 'professor' and posts.community_type = 'professor'))
      ))
    )
  );

create policy "users read own community reports"
  on public.reports for select to authenticated
  using (exists (
    select 1 from public.profiles p
    where p.id = reports.reporter_id and p.auth_user_id = (select auth.uid())
  ));

revoke select, insert, update, delete on
  public.posts, public.comments, public.post_reactions, public.reports
from anon;

do $$
declare
  expected_policy_count integer;
begin
  select count(*) into expected_policy_count
  from pg_policies
  where schemaname = 'public'
    and ((tablename = 'posts' and policyname in ('users read matching community posts', 'users create posts', 'authors update own posts', 'authors delete own posts'))
      or (tablename = 'comments' and policyname in ('users read matching community comments', 'users create comments', 'authors update own comments', 'authors delete own comments'))
      or (tablename = 'post_reactions' and policyname in ('users read matching community reactions', 'users create own community reactions', 'users delete own community reactions'))
      or (tablename = 'reports' and policyname in ('users create community reports', 'users read own community reports')));

  if expected_policy_count <> 13 then
    raise exception 'Community policy postcondition failed: % of 13', expected_policy_count;
  end if;

  if exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name in ('posts', 'comments', 'post_reactions', 'reports')
      and grantee = 'anon'
      and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
  ) then
    raise exception 'Anonymous community DML grants remain';
  end if;
end
$$;

commit;
