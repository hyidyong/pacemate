begin;

revoke all on function public.create_professor_question(uuid, text, text, uuid, uuid, text, boolean) from public;
revoke all on function public.create_professor_question(uuid, text, text, uuid, uuid, text, boolean) from anon;
grant execute on function public.create_professor_question(uuid, text, text, uuid, uuid, text, boolean) to authenticated;

commit;
