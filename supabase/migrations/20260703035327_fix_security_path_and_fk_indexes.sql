create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.set_updated_at() from public;
revoke all on function public.set_updated_at() from anon;
revoke all on function public.set_updated_at() from authenticated;

create index if not exists chat_sessions_user_id_idx on public.chat_sessions(user_id);
create index if not exists comments_author_id_idx on public.comments(author_id);
create index if not exists counseling_requests_student_id_idx on public.counseling_requests(student_id);
create index if not exists course_professors_professor_id_idx on public.course_professors(professor_id);
create index if not exists course_reviews_author_id_idx on public.course_reviews(author_id);
create index if not exists escalations_assigned_to_idx on public.escalations(assigned_to);
create index if not exists escalations_source_message_id_idx on public.escalations(source_message_id);
create index if not exists escalations_user_id_idx on public.escalations(user_id);
create index if not exists faqs_course_id_idx on public.faqs(course_id);
create index if not exists faqs_created_by_idx on public.faqs(created_by);
create index if not exists faqs_professor_id_idx on public.faqs(professor_id);
create index if not exists notices_created_by_idx on public.notices(created_by);
create index if not exists post_reactions_user_id_idx on public.post_reactions(user_id);
create index if not exists posts_author_id_idx on public.posts(author_id);
create index if not exists professor_availability_professor_id_idx on public.professor_availability(professor_id);
create index if not exists professors_department_id_idx on public.professors(department_id);
create index if not exists professors_profile_id_idx on public.professors(profile_id);
create index if not exists profiles_department_id_idx on public.profiles(department_id);
create index if not exists profiles_school_id_idx on public.profiles(school_id);
create index if not exists reports_reporter_id_idx on public.reports(reporter_id);
create index if not exists roadmap_requests_student_id_idx on public.roadmap_requests(student_id);
create index if not exists roadmap_results_request_id_idx on public.roadmap_results(request_id);
create index if not exists student_courses_course_id_idx on public.student_courses(course_id);
create index if not exists syllabi_course_id_idx on public.syllabi(course_id);
create index if not exists syllabi_uploaded_by_idx on public.syllabi(uploaded_by);

drop policy if exists "users write own student profile" on public.student_profiles;
create policy "users create own student profile" on public.student_profiles for insert to authenticated with check ((select auth.uid()) = profile_id);
create policy "users update own student profile" on public.student_profiles for update to authenticated using ((select auth.uid()) = profile_id) with check ((select auth.uid()) = profile_id);
create policy "users delete own student profile" on public.student_profiles for delete to authenticated using ((select auth.uid()) = profile_id);;
