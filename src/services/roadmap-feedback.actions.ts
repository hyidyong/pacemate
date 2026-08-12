"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createUserNotification } from "@/services/notifications.create.service";
import { getDemoProfile } from "@/services/session.service";

function text(value: FormDataEntryValue | null, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function looksLikeNoise(value: string) {
  const compact = value.replace(/\s/g, "");
  if (compact.length < 6) {
    return true;
  }

  return /(.)\1{5,}/.test(compact);
}

export async function submitRoadmapFeedback(formData: FormData) {
  const profile = await getDemoProfile();
  // Stage 9: this action wrote a curriculum-revision row and paged every admin
  // while treating `profile` as optional, so an unauthenticated POST could
  // attribute a report to "학생 익명 제보" without limit. A session is now
  // required, and the course must belong to the caller's own university.
  if (!profile) {
    return { ok: false, message: "로그인 후 이용해 주세요." };
  }
  const courseId = text(formData.get("courseId"));
  const courseCode = text(formData.get("courseCode"));
  const courseName = text(formData.get("courseName"), "과목");
  const reason = text(formData.get("reason"));

  if (!courseId || !courseCode) {
    return { ok: false, message: "과목 정보를 찾을 수 없습니다." };
  }

  if (looksLikeNoise(reason)) {
    return { ok: false, message: "수정이 필요한 내용을 한 문장으로 조금만 더 적어 주세요." };
  }

  const admin = createSupabaseAdminClient();
  const { data: course } = await admin
    .from("courses")
    .select("id, school_id")
    .eq("id", courseId)
    .maybeSingle();

  if (!course || course.school_id !== profile.school_id) {
    return { ok: false, message: "과목 정보를 찾을 수 없습니다." };
  }

  const title = `로드맵 오류 제보: ${courseName}`;
  const summary = reason.slice(0, 500);

  const { data, error } = await admin
    .from("roadmap_revision_requests")
    .insert({
      scope: "course",
      school_id: profile.school_id,
      status: "pending",
      course_code: courseCode,
      course_id: courseId,
      department_name: "법학과",
      title,
      summary,
      proposed_by: profile.id,
      proposed_by_name: profile.name,
      source_title: "학생 로드맵 오류 제보",
      source_url: `/roadmap/${courseId}`,
      proposed_patch: {},
    })
    .select("id")
    .single();

  if (error) {
    return { ok: false, message: "피드백을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }

  const notificationResult = await createUserNotification({
    recipientRole: "admin",
    recipientId: null,
    category: "revision",
    title: "학생 로드맵 오류 제보",
    body: `${courseName} 로드맵 수정 제보가 들어왔습니다.`,
    targetHref: `/admin?request=${data.id}`,
    schoolId: profile.school_id,
  });

  revalidatePath("/admin");
  revalidatePath("/notifications");
  revalidatePath(`/roadmap/${courseId}`);

  if (!notificationResult.ok) {
    return { ok: true, message: "수정 제보는 접수됐지만 알림 전송에 실패했습니다." };
  }

  return { ok: true, message: "제보를 보냈습니다. 운영 검토 후 반영 여부가 결정됩니다." };
}
