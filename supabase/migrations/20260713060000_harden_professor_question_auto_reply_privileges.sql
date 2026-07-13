begin;

do $$
declare
  privilege_name text;
begin
  if to_regclass('public.professor_question_auto_reply_rules') is null then
    raise exception 'public.professor_question_auto_reply_rules is required';
  end if;

  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'professor_question_auto_reply_rules'
      and c.relrowsecurity
  ) then
    raise exception 'RLS must be enabled on professor_question_auto_reply_rules';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'professor_question_auto_reply_rules'
      and policyname = 'professors manage own auto reply rules'
      and cmd = 'ALL'
      and roles = array['authenticated']::name[]
  ) then
    raise exception 'expected professor auto-reply ownership policy is missing';
  end if;

  foreach privilege_name in array array[
    'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
  ] loop
    if not has_table_privilege(
      'authenticated',
      'public.professor_question_auto_reply_rules',
      privilege_name
    ) then
      raise exception 'unexpected precondition: authenticated lacks %', privilege_name;
    end if;
  end loop;

  if has_table_privilege('anon', 'public.professor_question_auto_reply_rules', 'SELECT')
     or has_table_privilege('anon', 'public.professor_question_auto_reply_rules', 'INSERT')
     or has_table_privilege('anon', 'public.professor_question_auto_reply_rules', 'UPDATE')
     or has_table_privilege('anon', 'public.professor_question_auto_reply_rules', 'DELETE') then
    raise exception 'anon unexpectedly has auto-reply table privileges';
  end if;
end
$$;

revoke truncate, references, trigger
  on public.professor_question_auto_reply_rules
  from authenticated;

do $$
declare
  privilege_name text;
begin
  foreach privilege_name in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
    if not has_table_privilege(
      'authenticated',
      'public.professor_question_auto_reply_rules',
      privilege_name
    ) then
      raise exception 'required auto-reply CRUD privilege changed: %', privilege_name;
    end if;
  end loop;

  foreach privilege_name in array array['TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
    if has_table_privilege(
      'authenticated',
      'public.professor_question_auto_reply_rules',
      privilege_name
    ) then
      raise exception 'dangerous auto-reply privilege remains: %', privilege_name;
    end if;
  end loop;

  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'professor_question_auto_reply_rules'
      and c.relrowsecurity
  ) then
    raise exception 'RLS was unexpectedly disabled';
  end if;
end
$$;

commit;
