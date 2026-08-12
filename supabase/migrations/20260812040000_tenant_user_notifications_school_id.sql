-- Stage 6 (multi-tenancy) M3: user_notifications.school_id. Broadcast rows
-- (recipient_id IS NULL) have no parent to derive tenancy from, so this table
-- needs its own tenant column. Backfill: recipient-addressed rows inherit
-- their recipient's tenant; broadcast/remaining rows fall to the single
-- existing tenant. Runs AFTER the profiles backfill (M5) so recipient
-- provenance is fully populated.
begin;

do $$
begin
  if to_regclass('public.user_notifications') is null then
    raise exception 'public.user_notifications is required';
  end if;
  if (select count(*) from public.schools) <> 1 then
    raise exception 'M3 assumes a single existing tenant; found % schools',
      (select count(*) from public.schools);
  end if;
end
$$;

alter table public.user_notifications
  add column if not exists school_id uuid references public.schools(id);

-- Recipient-addressed rows inherit their recipient's tenant.
update public.user_notifications n
   set school_id = p.school_id
  from public.profiles p
 where p.id = n.recipient_id
   and n.school_id is null;

-- Broadcast rows (recipient_id NULL) and any stragglers fall to the default
-- tenant (only one exists).
update public.user_notifications
   set school_id = (select id from public.schools limit 1)
 where school_id is null;

create index if not exists user_notifications_school_recipient_idx
  on public.user_notifications (school_id, recipient_role);

do $$
begin
  if exists (select 1 from public.user_notifications where school_id is null) then
    raise exception 'user_notifications.school_id backfill incomplete';
  end if;
end
$$;

alter table public.user_notifications
  alter column school_id set not null;

commit;
