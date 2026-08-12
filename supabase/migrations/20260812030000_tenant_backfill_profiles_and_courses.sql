-- Stage 6 (multi-tenancy) M4+M5: make the existing school_id columns on
-- profiles and courses authoritative.
--   * profiles.school_id: backfill the legacy NULL accounts (professors,
--     admins, pre-auto-assign students) to the single existing tenant, then
--     NOT NULL so resolveTenantContext never sees a tenant-less profile.
--   * courses.school_id: already fully populated live; add NOT NULL to close
--     the unique(school_id, code) NULL-leak.
-- profiles.identifier uniqueness is intentionally NOT changed (stays global;
-- see docs/upgrade/stage-06/DESIGN.md 6.5 — Stage 7 owns tenant-qualified
-- identifiers).
begin;

do $$
begin
  if (select count(*) from public.schools) <> 1 then
    raise exception 'M4/M5 assume a single existing tenant; found % schools',
      (select count(*) from public.schools);
  end if;
  -- courses.school_id must already be complete (verified live: 0 NULL).
  if exists (select 1 from public.courses where school_id is null) then
    raise exception 'courses.school_id has NULL rows; backfill required before NOT NULL';
  end if;
end
$$;

-- profiles backfill to the default tenant.
update public.profiles
   set school_id = (select id from public.schools limit 1)
 where school_id is null;

do $$
begin
  if exists (select 1 from public.profiles where school_id is null) then
    raise exception 'profiles.school_id backfill incomplete';
  end if;
end
$$;

alter table public.profiles
  alter column school_id set not null;

alter table public.courses
  alter column school_id set not null;

commit;
