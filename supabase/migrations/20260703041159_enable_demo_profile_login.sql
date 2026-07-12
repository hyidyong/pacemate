grant select, insert on public.profiles to anon;

create policy "demo anon read profiles by identifier" on public.profiles
for select to anon
using (true);

create policy "demo anon create profiles" on public.profiles
for insert to anon
with check (identifier <> '' and name <> '');;
