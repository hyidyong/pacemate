begin;

-- 8-4A: add an explicit nullable link without changing profile identity or data.
do $$
declare
  column_record record;
begin
  select c.*
    into column_record
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name = 'profiles'
    and c.column_name = 'auth_user_id';

  if found and (
    column_record.udt_name <> 'uuid'
    or column_record.is_nullable <> 'YES'
    or column_record.column_default is not null
  ) then
    raise exception 'public.profiles.auth_user_id exists with an unexpected definition';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'auth'
      and table_name = 'users'
      and column_name = 'id'
      and udt_name = 'uuid'
  ) then
    raise exception 'auth.users.id uuid column is required before adding the mapping FK';
  end if;
end
$$;

alter table public.profiles
  add column if not exists auth_user_id uuid;

do $$
declare
  constraint_record record;
  auth_user_attnum smallint;
  constraint_exists boolean;
begin
  select a.attnum
    into auth_user_attnum
  from pg_attribute a
  where a.attrelid = 'public.profiles'::regclass
    and a.attname = 'auth_user_id'
    and not a.attisdropped;

  if auth_user_attnum is null then
    raise exception 'public.profiles.auth_user_id was not created';
  end if;

  if exists (
    select 1
    from pg_constraint c
    where c.conname = 'profiles_auth_user_id_fkey'
      and c.conrelid <> 'public.profiles'::regclass
  ) then
    raise exception 'profiles_auth_user_id_fkey is already used by another table';
  end if;

  if exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.profiles'::regclass
      and c.contype = 'f'
      and auth_user_attnum = any(c.conkey)
      and c.conname <> 'profiles_auth_user_id_fkey'
  ) then
    raise exception 'An unexpected FK already uses public.profiles.auth_user_id';
  end if;

  select c.*
    into constraint_record
  from pg_constraint c
  where c.conname = 'profiles_auth_user_id_fkey'
    and c.conrelid = 'public.profiles'::regclass;
  constraint_exists := found;

  if constraint_exists and (
    constraint_record.contype <> 'f'
    or constraint_record.confrelid <> 'auth.users'::regclass
    or constraint_record.confdeltype <> 'n'
    or pg_get_constraintdef(constraint_record.oid) !~* 'FOREIGN KEY \(auth_user_id\) REFERENCES auth\.users\(id\) ON DELETE SET NULL'
  ) then
    raise exception 'profiles_auth_user_id_fkey exists with an unexpected definition';
  end if;

  if not constraint_exists then
    alter table public.profiles
      add constraint profiles_auth_user_id_fkey
      foreign key (auth_user_id)
      references auth.users(id)
      on delete set null;
  end if;
end
$$;

do $$
declare
  index_record record;
  index_exists boolean;
begin
  select i.indisunique,
         pg_get_indexdef(i.indexrelid) as index_definition
    into index_record
  from pg_index i
  join pg_class index_class on index_class.oid = i.indexrelid
  join pg_namespace index_schema on index_schema.oid = index_class.relnamespace
  where index_schema.nspname = 'public'
    and index_class.relname = 'profiles_auth_user_id_key';
  index_exists := found;

  if index_exists and (
    not index_record.indisunique
    or index_record.index_definition !~* 'UNIQUE INDEX profiles_auth_user_id_key ON public\.profiles'
    or index_record.index_definition !~* '\(auth_user_id\)'
    or index_record.index_definition !~* 'WHERE \(auth_user_id IS NOT NULL\)'
  ) then
    raise exception 'profiles_auth_user_id_key exists with an unexpected definition';
  end if;

  if not index_exists then
    create unique index profiles_auth_user_id_key
      on public.profiles(auth_user_id)
      where auth_user_id is not null;
  end if;
end
$$;

commit;
