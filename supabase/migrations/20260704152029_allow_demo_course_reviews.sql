grant insert, update on public.course_reviews to anon;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'course_reviews'
      and policyname = 'demo anon create course reviews'
  ) then
    create policy "demo anon create course reviews"
    on public.course_reviews
    for insert
    to anon
    with check (author_id is not null and content <> '');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'course_reviews'
      and policyname = 'demo anon update course reviews'
  ) then
    create policy "demo anon update course reviews"
    on public.course_reviews
    for update
    to anon
    using (author_id is not null)
    with check (author_id is not null and content <> '');
  end if;
end $$;;
