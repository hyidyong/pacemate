import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { StudentAnnouncement } from "@/components/dashboard/student-announcement-feed";

export async function listStudentCourseNotices(studentId: string): Promise<StudentAnnouncement[]> {
  const supabase = createSupabaseAdminClient();
  const { data: enrollments, error: enrollmentError } = await supabase.from("student_courses").select("course_id").eq("student_id", studentId);
  if (enrollmentError) throw new Error("Student course assignments could not be read");
  const courseIds = [...new Set((enrollments ?? []).map((row) => row.course_id).filter((id): id is string => typeof id === "string"))];
  if (!courseIds.length) return [];
  const { data, error } = await supabase.from("posts").select("id,title,content,created_at,course_id,course:courses(name)").in("course_id", courseIds).eq("board_key", "course_notice").eq("status", "active").order("created_at", { ascending: false });
  if (error) throw new Error("Course notices could not be read");
  return (data ?? []).map((row: any) => ({ id: row.id, title: row.title ?? "공지사항", content: row.content ?? "", courseName: Array.isArray(row.course) ? row.course[0]?.name ?? null : row.course?.name ?? null, href: row.course_id ? `/courses/${row.course_id}` : "/courses", createdAt: row.created_at ?? null }));
}
