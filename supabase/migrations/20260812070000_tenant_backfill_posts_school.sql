-- Stage 6 (multi-tenancy) M8: backfill posts.school_id so the tenant-scoped
-- community board (getPosts) does not hide legacy posts. posts.school_id was
-- client-supplied and left NULL on some rows; with a single existing tenant
-- every legacy post belongs to it. Kept NULLABLE (posts remain anon-readable
-- until the Stage 9 RLS overhaul); this only backfills provenance so the
-- app-level tenant filter is complete.
--
-- Stage 9 amendment (2026-08-14): `posts.school_id` was created by hand in the
-- SQL editor and exists in NO migration, so this file — the first one that
-- depends on the column — aborted any attempt to rebuild the schema from the
-- chain, making staging and disaster recovery impossible (Stage 9 finding
-- S9-05 / D-1). The `add column if not exists` below repairs that at the first
-- point of use. It is a strict no-op on every database where this migration has
-- already run, and it does not change what this migration does. The nine other
-- hand-applied columns are repaired in 20260814020000. See DECISIONS.md D-024.
begin;

alter table public.posts
  add column if not exists school_id uuid references public.schools(id) on delete set null;

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
