grant select, insert, update, delete on public.student_profiles to anon;

drop policy if exists "demo anon manage student profiles" on public.student_profiles;
create policy "demo anon manage student profiles"
on public.student_profiles
for all
to anon
using (profile_id is not null)
with check (profile_id is not null);;
