"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createUserNotificationsWithClient } from "@/services/notifications.create.service";
import { getDemoProfile } from "@/services/session.service";

export async function getCourseRoadmap(courseId: string) {
  // Stage 9: this returned the full parsed syllabus of ANY course to ANY
  // caller — no session, no tenant, no enrolment. `syllabi` was also
  // anon-readable at the database, so both layers were open. The action now
  // requires a session and the course must be in the caller's own university.
  const profile = await getDemoProfile();
  if (!profile || !profile.school_id) {
    return { success: false, parsedText: null };
  }

  const admin = createSupabaseAdminClient();
  const { data: course } = await admin
    .from("courses")
    .select("id")
    .eq("id", courseId)
    .eq("school_id", profile.school_id)
    .maybeSingle();

  if (!course) {
    return { success: false, parsedText: null };
  }

  const { data, error } = await admin
    .from("syllabi")
    .select("parsed_text")
    .eq("course_id", courseId)
    .eq("parsing_status", "completed")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    return { success: false, parsedText: null };
  }

  return { success: true, parsedText: data.parsed_text };
}

/**
 * Codex round 5, F2 — a caller-supplied course id is not authorization.
 *
 * `removeCourseAssignment` checked only `role === "professor"` and then handed
 * the caller's own `courseId` to a service-role write. A Tenant A professor
 * could name a Tenant B course, or any course in their own tenant they do not
 * teach, and raise a curriculum revision request against it.
 *
 * Two things must BOTH hold before a privileged write, and neither can be
 * inferred from the other:
 *
 *   1. the course is in the caller's tenant     (course.school_id = profile.school_id)
 *   2. the caller is actually assigned to it    (course_professors OR course_offerings)
 *
 * (2) alone is not enough either: `course_professors` has no composite foreign
 * key, so a cross-tenant assignment row is structurally creatable (KI-022).
 * Checking both means neither a forged course id nor a stray assignment row is
 * sufficient on its own.
 *
 * Returns the verified course id, or null — and the caller must write nothing
 * on null.
 */
async function authorizeProfessorCourse(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  profile: { id: string; school_id: string | null },
  courseId: string,
): Promise<string | null> {
  if (!courseId || !profile.school_id) return null;

  const { data: course } = await admin
    .from("courses")
    .select("id, school_id")
    .eq("id", courseId)
    .maybeSingle();
  if (!course || course.school_id !== profile.school_id) return null;

  const { data: professor } = await admin
    .from("professors")
    .select("id")
    .eq("profile_id", profile.id)
    .maybeSingle();
  if (!professor) return null;

  const [{ data: mapping }, { data: offering }] = await Promise.all([
    admin
      .from("course_professors")
      .select("course_id")
      .eq("course_id", courseId)
      .eq("professor_id", professor.id)
      .limit(1),
    admin
      .from("course_offerings")
      .select("course_id")
      .eq("course_id", courseId)
      .eq("professor_id", professor.id)
      .limit(1),
  ]);
  if (!mapping?.length && !offering?.length) return null;

  return course.id as string;
}

export async function removeCourseAssignment(formData: FormData) {
  const profile = await getDemoProfile();
  if (!profile || profile.role !== "professor") {
    return { message: "교수 권한이 필요합니다." };
  }

  const courseId = formData.get("courseId") as string;
  if (!courseId) return { message: "과목을 선택해주세요." };

  const admin = createSupabaseAdminClient();
  // The role gate above says WHAT the caller is. It says nothing about whether
  // this course is theirs, and the write below runs with privileges that
  // bypass RLS — so the relationship is established here, before anything is
  // written.
  const authorizedCourseId = await authorizeProfessorCourse(admin, profile, courseId);
  if (!authorizedCourseId) {
    return { message: "담당하고 있는 과목만 요청할 수 있습니다." };
  }

  // Stage 9: session roles no longer hold INSERT on this table; the checks
  // above are the authorization and the service role performs the write.
  const { error } = await admin.from("roadmap_revision_requests").insert({
    scope: "course",
      school_id: profile.school_id,
    status: "pending",
    course_id: authorizedCourseId,
    title: "담당 과목 삭제 요청",
    summary: "해당 과목 담당 교수에서 제외해 주십시오.",
    proposed_by: profile.id,
    proposed_by_name: profile.name,
    source_title: "교수 과목관리 탭",
    source_url: "/professor",
    proposed_patch: {},
  });

  if (error) {
    console.error("Failed to request removal:", error);
    return { message: "요청 실패" };
  }

  revalidatePath("/professor");
  return { message: "담당 과목 삭제 요청이 관리자에게 전송되었습니다." };
}

export async function addCourseNotice(formData: FormData) {
  const profile = await getDemoProfile();
  if (!profile || profile.role !== "professor") {
    return { message: "교수 권한이 필요합니다." };
  }

  let admin;
  try {
    admin = createSupabaseAdminClient();
  } catch (error) {
    console.error("Course notice admin client is unavailable:", error);
    return { message: "공지사항 저장을 시작할 수 없습니다." };
  }

  const courseId = String(formData.get("courseId") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  const content = String(formData.get("content") ?? "").trim();

  if (!courseId || !title || !content) {
    return { message: "모든 필드를 입력해주세요." };
  }

  // This action already checked the ASSIGNMENT, which is why F2 did not name
  // it. It did not check the TENANT, and course_professors has no composite
  // foreign key, so a cross-tenant assignment row is structurally creatable
  // (KI-022). Both actions now answer the question through one helper.
  const authorizedCourseId = await authorizeProfessorCourse(admin, profile, courseId);
  if (!authorizedCourseId) {
    return { message: "해당 과목에 공지를 등록할 권한이 없습니다." };
  }

  // 1. Save Notice
  const { error: noticeError } = await admin.from("posts").insert({
    author_id: profile.id,
    school_id: profile.school_id,
    course_id: authorizedCourseId,
    community_type: "student",
    board_key: "course_notice",
    category: "notice",
    title,
    content,
    display_mode: "public",
    status: "active",
  });

  if (noticeError) {
    console.error("Failed to add notice:", noticeError);
    return { message: "공지사항 등록에 실패했습니다." };
  }

  // 2. Notify Students
  const { data: studentCourses } = await admin
    .from("student_courses")
    .select("student_id, courses(name)")
    .eq("course_id", courseId)
    .in("status", ["completed", "interested"]);

  revalidatePath("/professor");
  revalidatePath("/dashboard");
  revalidatePath("/notices");
  revalidatePath("/notifications");
  revalidatePath(`/courses/${courseId}`);

  if (studentCourses && studentCourses.length > 0) {
    const courseName = Array.isArray(studentCourses[0].courses)
      ? studentCourses[0].courses[0]?.name ?? "과목"
      : (studentCourses[0].courses as any)?.name ?? "과목";

    const notifications = studentCourses.map((sc) => ({
      recipientRole: "student" as const,
      recipientId: sc.student_id,
      category: "system" as const,
      title: `[${courseName}] 새로운 공지사항이 등록되었습니다.`,
      body: title,
      targetHref: "/notices",
    }));

    const notificationResult = await createUserNotificationsWithClient(admin, notifications);
    if (!notificationResult.ok) {
      return { message: "공지사항은 등록됐지만 알림 전송에 실패했습니다." };
    }
  }

  return { message: "공지사항이 성공적으로 등록되었습니다." };
}

export async function addCourseTextbook(formData: FormData) {
  const profile = await getDemoProfile();
  if (!profile || profile.role !== "professor") {
    return { message: "교수 권한이 필요합니다." };
  }

  let admin;
  try {
    admin = createSupabaseAdminClient();
  } catch (error) {
    console.error("Course textbook admin client is unavailable:", error);
    return { message: "교과서 저장을 시작할 수 없습니다." };
  }

  const courseId = String(formData.get("courseId") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const link = String(formData.get("link") ?? "").trim();

  if (!courseId || !name) {
    return { message: "교재 이름을 입력해주세요." };
  }

  // Same shape as addCourseNotice: the assignment was checked, the TENANT was
  // not. One helper answers it for all three privileged course actions.
  const authorizedCourseId = await authorizeProfessorCourse(admin, profile, courseId);
  if (!authorizedCourseId) {
    return { message: "해당 과목에 교과서를 등록할 권한이 없습니다." };
  }

  // Store textbooks in the course notice feed so students see the course-scoped update.
  const { error: textbookError } = await admin.from("posts").insert({
    author_id: profile.id,
    school_id: profile.school_id,
    course_id: authorizedCourseId,
    community_type: "student",
    board_key: "course_notice",
    category: "textbook",
    title: `[교과서] ${name}`,
    content: link || "링크 없음",
    display_mode: "public",
    status: "active",
  });

  if (textbookError) {
    console.error("Failed to add textbook:", textbookError);
    return { message: "교재 등록에 실패했습니다." };
  }

  // 2. Notify Students
  const { data: studentCourses } = await admin
    .from("student_courses")
    .select("student_id, courses(name)")
    .eq("course_id", courseId)
    .in("status", ["completed", "interested"]);

  revalidatePath("/professor");
  revalidatePath("/dashboard");
  revalidatePath("/notices");
  revalidatePath("/notifications");
  revalidatePath(`/courses/${courseId}`);

  if (studentCourses && studentCourses.length > 0) {
    const courseName = Array.isArray(studentCourses[0].courses)
      ? studentCourses[0].courses[0]?.name ?? "과목"
      : (studentCourses[0].courses as any)?.name ?? "과목";

    const notifications = studentCourses.map((sc) => ({
      recipientRole: "student" as const,
      recipientId: sc.student_id,
      category: "system" as const,
      title: `[${courseName}] 추천 교과서가 추가되었습니다.`,
      body: name,
      targetHref: "/notices",
    }));

    const notificationResult = await createUserNotificationsWithClient(admin, notifications);
    if (!notificationResult.ok) {
      return { message: "교재는 등록됐지만 알림 전송에 실패했습니다." };
    }
  }

  return { message: "교과서가 성공적으로 등록되었습니다." };
}
