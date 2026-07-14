import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { StudentAnnouncement } from "@/components/dashboard/student-announcement-feed";

export async function listStudentCourseNotices(studentId: string): Promise<StudentAnnouncement[]> {
  let supabase;
  try {
    supabase = createSupabaseAdminClient();
  } catch (error) {
    console.error("Student course notices admin client is unavailable:", error);
    return [];
  }

  const { data: enrollments, error: enrollmentError } = await supabase
    .from("student_courses")
    .select("course_id, status")
    .eq("student_id", studentId);

  if (enrollmentError) {
    return [];
  }

  const courseIds = [
    ...new Set(
      (enrollments ?? [])
        .map((row) => row.course_id)
        .filter((id): id is string => typeof id === "string"),
    ),
  ];

  if (!courseIds.length) {
    return [];
  }

  const { data, error } = await supabase
    .from("posts")
    .select("id,title,content,created_at,course_id,course:courses(name)")
    .in("course_id", courseIds)
    .eq("board_key", "course_notice")
    .eq("community_type", "student")
    .eq("status", "active")
    .order("created_at", { ascending: false });

  if (error) {
    return [];
  }

  return (data ?? []).map((row: any) => ({
    id: row.id,
    title: row.title ?? "공지사항",
    content: row.content ?? "",
    courseName: Array.isArray(row.course) ? row.course[0]?.name ?? null : row.course?.name ?? null,
    href: row.course_id ? `/courses/${row.course_id}` : "/courses",
    createdAt: row.created_at ?? null,
  }));
}
