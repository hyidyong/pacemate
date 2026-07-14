"use server";

import { revalidatePath } from "next/cache";
import { getCounselingSlotId } from "@/lib/counseling-slots";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { normalizeUuid } from "@/lib/uuid";
import { getAvailableCounselingSlots } from "@/services/counseling.service";
import { createUserNotification } from "@/services/notifications.create.service";
import { getDemoProfile } from "@/services/session.service";

const SLOT_NOT_AVAILABLE_MESSAGE = "선택한 상담 시간을 예약할 수 없습니다. 다른 시간을 선택해 주세요.";

function text(value: FormDataEntryValue | null, fallback = "") {
  const current = typeof value === "string" ? value.trim() : "";
  return current || fallback;
}

export async function createCounselingRequest(formData: FormData) {
  const profile = await getDemoProfile();
  const slotId = text(formData.get("slotId"));
  const topic = text(formData.get("topic"), "상담 요청");

  if (!profile || profile.role !== "student") {
    return { ok: false, message: "로그인한 학생만 상담을 신청할 수 있습니다." };
  }

  if (!slotId) {
    return { ok: false, message: SLOT_NOT_AVAILABLE_MESSAGE };
  }

  let availableSlots;
  try {
    availableSlots = await getAvailableCounselingSlots();
  } catch {
    return { ok: false, message: SLOT_NOT_AVAILABLE_MESSAGE };
  }

  const selectedSlot = availableSlots.find((slot) => getCounselingSlotId(slot) === slotId);
  if (!selectedSlot) {
    return { ok: false, message: SLOT_NOT_AVAILABLE_MESSAGE };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("counseling_requests")
    .insert({
      student_id: profile.id,
      professor_id: selectedSlot.professorId,
      requested_start: selectedSlot.start,
      requested_end: selectedSlot.end,
      topic,
      status: "pending",
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("[counseling] counseling request insert failed", {
      operation: "createCounselingRequest",
      table: "counseling_requests",
      code: error?.code ?? "missing_insert_result",
      message: error?.message ?? "Insert returned no row",
      details: error?.details ?? null,
      hint: error?.hint ?? null,
    });
    return { ok: false, message: "상담 신청을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }

  const notificationResult = await createUserNotification({
    recipientRole: "professor",
    recipientId: null,
    category: "counseling",
    title: "새 상담 신청",
    body: `${profile.name} 학생이 ${topic} 상담을 신청했습니다.`,
    targetHref: `/professor?tab=counseling&sub=pending-counseling&requestId=${encodeURIComponent(data.id)}`,
  });

  revalidatePath("/counseling");
  revalidatePath("/professor");

  if (!notificationResult.ok) {
    return { ok: true, message: "상담 신청은 완료됐지만 알림 전송에 실패했습니다." };
  }

  return { ok: true, message: `상담 신청을 보냈습니다. (${data.id.slice(0, 8)})` };
}

export async function reserveSuggestedCounseling(formData: FormData) {
  const profile = await getDemoProfile();
  const originalRequestId = normalizeUuid(text(formData.get("requestId")));

  if (!profile || profile.role !== "student" || !originalRequestId) {
    return { ok: false, message: "추천 상담 요청을 찾을 수 없습니다." };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("counseling_requests")
    .select("professor_id, topic, suggested_start, suggested_end")
    .eq("id", originalRequestId)
    .eq("student_id", profile.id)
    .maybeSingle();

  if (error || !data?.suggested_start || !data.suggested_end) {
    return { ok: false, message: "예약할 추천 시간이 없습니다." };
  }

  const request = new FormData();
  request.set(
    "slotId",
    getCounselingSlotId({
      professorId: data.professor_id,
      start: data.suggested_start,
      end: data.suggested_end,
    }),
  );
  request.set("topic", `${data.topic} (추천 시간 재신청)`);
  return createCounselingRequest(request);
}
