-- Stage 6 (multi-tenancy) M8: backfill posts.school_id so the tenant-scoped
-- community board (getPosts) does not hide legacy posts. posts.school_id was
-- client-supplied and left NULL on some rows; with a single existing tenant
-- every legacy post belongs to it. Kept NULLABLE (posts remain anon-readable
-- until the Stage 9 RLS overhaul); this only backfills provenance so the
-- app-level tenant filter is complete.
begin;

do $$
begin
  if (select count(*) from public.schools) <> 1 then
    raise exception 'M8 assumes a single existing tenant; found % schools',
      (select count(*) from public.schools);
  end if;
end
$$;

update public.posts
   set school_id = (select id from public.schools limit 1)
 where school_id is null;

do $$
begin
  if exists (select 1 from public.posts where school_id is null) then
    raise exception 'posts.school_id backfill incomplete';
  end if;
end
$$;

commit;
