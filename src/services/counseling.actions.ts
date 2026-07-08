"use server";

import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase/client";
import {
  isStudentBookableRange,
  localDateKey,
  timeToMinutes,
} from "@/lib/scheduling-policy";
import { getDemoProfile } from "@/services/session.service";

function text(value: FormDataEntryValue | null, fallback = "") {
  const current = typeof value === "string" ? value.trim() : "";
  return current || fallback;
}

export async function createCounselingRequest(formData: FormData) {
  const profile = await getDemoProfile();
  const professorId = text(formData.get("professorId"));
  const requestedStart = text(formData.get("requestedStart"));
  const requestedEnd = text(formData.get("requestedEnd"));
  const topic = text(formData.get("topic"), "상담 요청");

  if (!profile) {
    return { ok: false, message: "로그인 후 상담을 신청할 수 있습니다." };
  }

  if (!professorId || !requestedStart || !requestedEnd) {
    return { ok: false, message: "상담 시간 정보를 찾을 수 없습니다." };
  }

  if (!isStudentBookableRange(new Date(requestedStart), new Date(requestedEnd))) {
    return { ok: false, message: "상담 신청은 평일 18:00 이전 시간만 가능합니다." };
  }

  const conflict = await hasConflict(professorId, requestedStart, requestedEnd);

  if (conflict) {
    return { ok: false, message: "이미 신청되었거나 수업과 겹치는 시간입니다." };
  }

  const { data, error } = await supabase
    .from("counseling_requests")
    .insert({
      student_id: profile.id,
      professor_id: professorId,
      requested_start: requestedStart,
      requested_end: requestedEnd,
      topic,
      status: "pending",
    })
    .select("id, professor_id")
    .single();

  if (error) {
    return { ok: false, message: error.message };
  }

  await supabase.from("user_notifications").insert({
    recipient_role: "professor",
    category: "counseling",
    title: "새 상담 신청",
    body: `${profile.name} 학생이 ${topic} 상담을 신청했습니다.`,
    target_href: "/professor?tab=counseling",
  });

  revalidatePath("/counseling");
  revalidatePath("/professor");
  return { ok: true, message: `상담 신청을 보냈습니다. (${data.id.slice(0, 8)})` };
}

export async function reserveSuggestedCounseling(formData: FormData) {
  const originalRequestId = text(formData.get("requestId"));

  if (!originalRequestId) {
    return { ok: false, message: "추천 상담 요청을 찾을 수 없습니다." };
  }

  const { data, error } = await supabase
    .from("counseling_requests")
    .select("student_id, professor_id, topic, suggested_start, suggested_end")
    .eq("id", originalRequestId)
    .single();

  if (error || !data?.suggested_start || !data?.suggested_end) {
    return { ok: false, message: "예약할 추천 시간이 없습니다." };
  }

  const form = new FormData();
  form.set("professorId", data.professor_id);
  form.set("requestedStart", data.suggested_start);
  form.set("requestedEnd", data.suggested_end);
  form.set("topic", `${data.topic} (추천 시간 재신청)`);
  return createCounselingRequest(form);
}

async function hasConflict(professorId: string, requestedStart: string, requestedEnd: string) {
  const start = new Date(requestedStart);
  const end = new Date(requestedEnd);

  const [
    { data: requests, error: requestError },
    { data: teachingSlots, error: teachingError },
    { data: availability, error: availabilityError },
    { data: adminTasks, error: adminError },
  ] =
    await Promise.all([
      supabase
        .from("counseling_requests")
        .select("requested_start, requested_end")
        .eq("professor_id", professorId)
        .in("status", ["pending", "approved"]),
      supabase
        .from("professor_teaching_slots")
        .select("day_of_week, start_time, end_time")
        .eq("professor_id", professorId),
      supabase
        .from("professor_availability")
        .select("day_of_week, specific_date, start_time, end_time, is_active")
        .eq("professor_id", professorId),
      supabase
        .from("professor_admin_tasks")
        .select("title, day_of_week, start_time, end_time")
        .eq("professor_id", professorId),
    ]);

  if (requestError || teachingError || availabilityError || adminError) {
    return true;
  }

  const matchingAvailability = (availability ?? []).some((item) => {
    if (!item.is_active || !availabilityMatchesDate(item, start)) {
      return false;
    }

    return containsTimeOnly(start, end, item.start_time, item.end_time);
  });
  const requestConflict = (requests ?? []).some((request) =>
    overlaps(start, end, new Date(request.requested_start), new Date(request.requested_end)),
  );
  const teachingConflict = (teachingSlots ?? []).some((slot) => {
    if (slot.day_of_week !== start.getDay()) {
      return false;
    }

    return overlaps(start, end, withTime(start, slot.start_time), withTime(start, slot.end_time));
  });
  const adminConflict = (adminTasks ?? []).some((task) => {
    if (!adminTaskMatchesDate(task, start)) {
      return false;
    }

    return overlaps(start, end, withTime(start, task.start_time), withTime(start, task.end_time));
  });
  const blackoutConflict = (availability ?? []).some((item) => {
    if (item.is_active || !availabilityMatchesDate(item, start)) {
      return false;
    }

    return overlaps(start, end, withTime(start, item.start_time), withTime(start, item.end_time));
  });

  return !matchingAvailability || requestConflict || teachingConflict || adminConflict || blackoutConflict;
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && bStart < aEnd;
}

function withTime(date: Date, time: string) {
  const [hour = "0", minute = "0"] = time.split(":");
  const next = new Date(date);
  next.setHours(Number(hour), Number(minute), 0, 0);
  return next;
}

function availabilityMatchesDate(
  item: { day_of_week: number | null; specific_date: string | null },
  date: Date,
) {
  if (item.specific_date) {
    return item.specific_date === localDateKey(date);
  }

  return item.day_of_week === date.getDay();
}

function adminTaskMatchesDate(
  task: { title: string; day_of_week: number | null },
  date: Date,
) {
  if (task.title.startsWith("__BLACKOUT__")) {
    return task.title.split("__")[2] === localDateKey(date);
  }

  return task.day_of_week === date.getDay();
}

function containsTimeOnly(start: Date, end: Date, windowStart: string, windowEnd: string) {
  const requestStart = start.getHours() * 60 + start.getMinutes();
  const requestEnd = end.getHours() * 60 + end.getMinutes();
  return requestStart >= timeToMinutes(windowStart) && requestEnd <= timeToMinutes(windowEnd);
}
