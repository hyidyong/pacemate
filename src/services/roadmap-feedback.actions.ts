"use server";

import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase/client";
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

  const title = `로드맵 오류 제보: ${courseName}`;
  const summary = reason.slice(0, 500);

  const { data, error } = await supabase
    .from("roadmap_revision_requests")
    .insert({
      scope: "course",
      status: "pending",
      course_code: courseCode,
      course_id: courseId,
      department_name: "법학과",
      title,
      summary,
      proposed_by: profile?.id ?? null,
      proposed_by_name: profile?.name ?? "학생 익명 제보",
      source_title: "학생 로드맵 오류 제보",
      source_url: `/roadmap/${courseId}`,
      proposed_patch: {},
    })
    .select("id")
    .single();

  if (error) {
    return { ok: false, message: error.message };
  }

  const notificationResult = await createUserNotification({
    recipientRole: "admin",
    recipientId: null,
    category: "revision",
    title: "학생 로드맵 오류 제보",
    body: `${courseName} 로드맵 수정 제보가 들어왔습니다.`,
    targetHref: `/admin?request=${data.id}`,
  });

  revalidatePath("/admin");
  revalidatePath("/notifications");
  revalidatePath(`/roadmap/${courseId}`);

  if (!notificationResult.ok) {
    return { ok: true, message: "수정 제보는 접수됐지만 알림 전송에 실패했습니다." };
  }

  return { ok: true, message: "제보를 보냈습니다. 운영 검토 후 반영 여부가 결정됩니다." };
}
