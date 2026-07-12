"use server";

import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase/client";
import { createUserNotifications } from "@/services/notifications.create.service";
import { getDemoProfile } from "@/services/session.service";

export async function getCourseRoadmap(courseId: string) {
  const { data, error } = await supabase
    .from("syllabi")
    .select("parsed_text")
    .eq("course_id", courseId)
    .single();

  if (error || !data) {
    return { success: false, parsedText: null };
  }

  return { success: true, parsedText: data.parsed_text };
}

export async function removeCourseAssignment(formData: FormData) {
  const profile = await getDemoProfile();
  if (!profile || profile.role !== "professor") {
    return { message: "교수 권한이 필요합니다." };
  }

  const courseId = formData.get("courseId") as string;
  if (!courseId) return { message: "과목을 선택해주세요." };

  const { error } = await supabase.from("roadmap_revision_requests").insert({
    scope: "course",
    status: "pending",
    course_id: courseId,
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

  const courseId = formData.get("courseId") as string;
  const title = formData.get("title") as string;
  const content = formData.get("content") as string;

  if (!courseId || !title || !content) {
    return { message: "모든 필드를 입력해주세요." };
  }

  // 1. Save Notice
  const { error: noticeError } = await supabase.from("posts").insert({
    author_id: profile.id,
    course_id: courseId,
    board_key: "course_notice",
    category: "notice",
    title,
    content,
    display_mode: "public",
  });

  if (noticeError) {
    console.error("Failed to add notice:", noticeError);
    return { message: "공지사항 등록에 실패했습니다." };
  }

  // 2. Notify Students
  const { data: studentCourses } = await supabase
    .from("student_courses")
    .select("student_id, courses(name)")
    .eq("course_id", courseId)
    .eq("status", "interested"); // Or whatever status is active

  revalidatePath("/professor");

  if (studentCourses && studentCourses.length > 0) {
    const courseName = Array.isArray(studentCourses[0].courses)
      ? studentCourses[0].courses[0].name
      : (studentCourses[0].courses as any)?.name ?? "과목";

    const notifications = studentCourses.map((sc) => ({
      recipientRole: "student" as const,
      recipientId: sc.student_id,
      category: "system" as const,
      title: `[${courseName}] 새로운 공지사항이 등록되었습니다.`,
      body: title,
      targetHref: `/courses/${courseId}`,
    }));

    const notificationResult = await createUserNotifications(notifications);
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

  const courseId = formData.get("courseId") as string;
  const name = formData.get("name") as string;
  const link = formData.get("link") as string;

  if (!courseId || !name) {
    return { message: "교재 이름을 입력해주세요." };
  }

  // 1. Save Textbook
  const { error: textbookError } = await supabase.from("posts").insert({
    author_id: profile.id,
    course_id: courseId,
    board_key: "course_material",
    category: "textbook",
    title: name,
    content: link || "링크 없음",
    display_mode: "public",
  });

  if (textbookError) {
    console.error("Failed to add textbook:", textbookError);
    return { message: "교재 등록에 실패했습니다." };
  }

  // 2. Notify Students
  const { data: studentCourses } = await supabase
    .from("student_courses")
    .select("student_id, courses(name)")
    .eq("course_id", courseId)
    .eq("status", "interested");

  revalidatePath("/professor");

  if (studentCourses && studentCourses.length > 0) {
    const courseName = Array.isArray(studentCourses[0].courses)
      ? studentCourses[0].courses[0].name
      : (studentCourses[0].courses as any)?.name ?? "과목";

    const notifications = studentCourses.map((sc) => ({
      recipientRole: "student" as const,
      recipientId: sc.student_id,
      category: "system" as const,
      title: `[${courseName}] 추천 교과서가 추가되었습니다.`,
      body: name,
      targetHref: `/courses/${courseId}`,
    }));

    const notificationResult = await createUserNotifications(notifications);
    if (!notificationResult.ok) {
      return { message: "교재는 등록됐지만 알림 전송에 실패했습니다." };
    }
  }

  return { message: "교과서가 성공적으로 등록되었습니다." };
}
