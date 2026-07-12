grant update on public.profiles to anon;

drop policy if exists "demo anon update profiles" on public.profiles;
create policy "demo anon update profiles"
on public.profiles
for update
to anon
using (identifier <> '' and name <> '')
with check (identifier <> '' and name <> '');;
