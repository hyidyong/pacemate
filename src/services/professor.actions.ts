"use server";

import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase/client";
import { textareaToList } from "@/services/roadmap-revisions.service";
import { getDemoProfile } from "@/services/session.service";

function text(value: FormDataEntryValue | null, fallback = "") {
  const current = typeof value === "string" ? value.trim() : "";
  return current || fallback;
}

function integer(value: FormDataEntryValue | null, fallback: number) {
  const parsed = Number.parseInt(text(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function getCurrentProfessorForAction(profileId?: string | null) {
  if (profileId) {
    const { data } = await supabase
      .from("professors")
      .select("id, name")
      .eq("profile_id", profileId)
      .maybeSingle();

    if (data) {
      return data;
    }
  }

  const { data } = await supabase
    .from("professors")
    .select("id, name")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  return data;
}

async function resolveOwnedCourse(courseValue: string, profileId?: string | null) {
  const [courseCode, courseId] = courseValue.split("|");

  if (!courseCode || !courseId) {
    return { ok: false as const, message: "수정할 담당 과목을 선택해 주세요." };
  }

  const professor = await getCurrentProfessorForAction(profileId);

  if (!professor?.id) {
    return { ok: false as const, message: "연결된 교수 정보를 찾을 수 없습니다." };
  }

  const { data, error } = await supabase
    .from("course_professors")
    .select("course_id")
    .eq("professor_id", professor.id)
    .eq("course_id", courseId)
    .maybeSingle();

  if (error) {
    return { ok: false as const, message: error.message };
  }

  if (!data) {
    return { ok: false as const, message: "자기 담당 과목에 한해서만 로드맵을 수정할 수 있습니다." };
  }

  return {
    ok: true as const,
    courseCode,
    courseId,
    professorId: professor.id,
    professorName: professor.name,
  };
}

export async function addProfessorAvailability(formData: FormData) {
  const professorId = text(formData.get("professorId"));
  const day = integer(formData.get("dayOfWeek"), 1);
  const startTime = text(formData.get("startTime"), "10:00");
  const endTime = text(formData.get("endTime"), "12:00");
  const slotMinutes = integer(formData.get("slotMinutes"), 30);
  const isActive = formData.get("isActive") === "false" ? false : true;

  if (!professorId) {
    return { ok: false, message: "교수 정보를 찾을 수 없습니다." };
  }

  const { error } = await supabase.from("professor_availability").insert({
    professor_id: professorId,
    day_of_week: day,
    start_time: startTime,
    end_time: endTime,
    slot_minutes: slotMinutes,
    is_active: isActive,
  });

  if (error) {
    return { ok: false, message: error.message };
  }

  revalidatePath("/professor");
  return { ok: true, message: "상담 가능 시간이 추가됐습니다." };
}

export async function addProfessorFaq(formData: FormData) {
  const profile = await getDemoProfile();
  const professorId = text(formData.get("professorId"));
  const courseId = text(formData.get("courseId"));
  const question = text(formData.get("question"));
  const answer = text(formData.get("answer"));

  if (!professorId || !question || !answer) {
    return { ok: false, message: "질문과 답변을 입력해 주세요." };
  }

  const isTA = profile?.role === "assistant";
  const prefix = isTA ? "[조교 답변] " : "";

  const { error } = await supabase.from("faqs").insert({
    professor_id: professorId,
    course_id: courseId || null,
    question,
    answer: `${prefix}${answer}`,
    category: "교수 답변",
    approved_at: new Date().toISOString(),
  });

  if (error) {
    return { ok: false, message: error.message };
  }

  revalidatePath("/professor");
  return { ok: true, message: "FAQ 답변을 저장했습니다." };
}

export async function updateCounselingStatus(formData: FormData) {
  const requestId = text(formData.get("requestId"));
  const status = text(formData.get("status"));
  const professorNote = text(formData.get("professorNote"));
  const suggestedStart = text(formData.get("suggestedStart"));
  const suggestedEnd = text(formData.get("suggestedEnd"));

  if (!requestId || !["pending", "approved", "rejected", "cancelled"].includes(status)) {
    return { ok: false, message: "상담 요청을 처리할 수 없습니다." };
  }

  if (status === "rejected" && (!professorNote || !suggestedStart)) {
    return { ok: false, message: "거절 사유와 추천 시간대를 입력해 주세요." };
  }

  const { data, error } = await supabase
    .from("counseling_requests")
    .update({
      status,
      professor_note: professorNote || null,
      suggested_start: suggestedStart || null,
      suggested_end: suggestedEnd || null,
    })
    .eq("id", requestId)
    .select("id, student_id, topic, requested_start, suggested_start")
    .single();

  if (error) {
    return { ok: false, message: error.message };
  }

  await supabase.from("user_notifications").insert({
    recipient_role: "student",
    recipient_id: data.student_id,
    category: "counseling",
    title: status === "approved" ? "상담 신청이 승인됐습니다" : "상담 시간이 조정 필요합니다",
    body:
      status === "approved"
        ? professorNote || `${data.topic} 상담 신청이 승인됐습니다.`
        : `${professorNote} 추천 시간으로 다시 예약할 수 있습니다.`,
    target_href: "/counseling",
  });

  revalidatePath("/professor");
  revalidatePath("/counseling");
  return { ok: true, message: "상담 상태를 변경했습니다." };
}

export async function createRoadmapRevisionRequest(formData: FormData) {
  const profile = await getDemoProfile();
  const scope = text(formData.get("scope"), "course");
  const courseValue = text(formData.get("course"));
  const departmentName = text(formData.get("departmentName"), "법학과");
  const title = text(formData.get("title"));
  const summary = text(formData.get("summary"));
  const sourceTitle = text(formData.get("sourceTitle"));
  const sourceUrl = text(formData.get("sourceUrl"));
  const shortReason = text(formData.get("shortReason"));
  const basics = textareaToList(text(formData.get("basics")));
  const generalStudyMethod = textareaToList(text(formData.get("generalStudyMethod")));
  const courseStudyMethod = textareaToList(text(formData.get("courseStudyMethod")));
  const weeklyFocus = textareaToList(text(formData.get("weeklyFocus")));
  const ownedCourse =
    scope === "course" ? await resolveOwnedCourse(courseValue, profile?.id) : null;

  if (!title || !summary || !shortReason) {
    return { ok: false, message: "제목, 요약, 추천 사유를 입력해 주세요." };
  }

  if (ownedCourse && !ownedCourse.ok) {
    return { ok: false, message: ownedCourse.message };
  }

  const proposedPatch = {
    shortReason,
    ...(basics.length ? { basics } : {}),
    ...(generalStudyMethod.length ? { generalStudyMethod } : {}),
    ...(courseStudyMethod.length ? { courseStudyMethod } : {}),
    ...(weeklyFocus.length ? { weeklyFocus } : {}),
  };

  const { data, error } = await supabase
    .from("roadmap_revision_requests")
    .insert({
      scope: scope === "department" ? "department" : "course",
      status: "pending",
      course_code: scope === "department" ? null : ownedCourse?.courseCode ?? null,
      course_id: scope === "department" ? null : ownedCourse?.courseId ?? null,
      department_name: departmentName,
      title,
      summary,
      proposed_by: profile?.id ?? null,
      proposed_by_name: profile?.name ?? "교수",
      source_title: sourceTitle || null,
      source_url: sourceUrl || null,
      proposed_patch: proposedPatch,
    })
    .select("id")
    .single();

  if (error) {
    return { ok: false, message: error.message };
  }

  await supabase.from("user_notifications").insert({
    recipient_role: "admin",
    category: "revision",
    title: "로드맵 수정 승인 요청",
    body: `${title} 요청이 관리자 승인을 기다립니다.`,
    target_href: `/admin?request=${data.id}`,
  });

  revalidatePath("/professor");
  revalidatePath("/admin");
  return { ok: true, message: "로드맵 수정 요청을 보냈습니다." };
}

export async function updateOwnCourseRoadmap(formData: FormData) {
  const profile = await getDemoProfile();
  const courseValue = text(formData.get("course"));
  const title = text(formData.get("title"), "교수 직접 수정");
  const shortReason = text(formData.get("shortReason"));
  const basics = textareaToList(text(formData.get("basics")));
  const generalStudyMethod = textareaToList(text(formData.get("generalStudyMethod")));
  const courseStudyMethod = textareaToList(text(formData.get("courseStudyMethod")));
  const weeklyFocus = textareaToList(text(formData.get("weeklyFocus")));
  const ownedCourse = await resolveOwnedCourse(courseValue, profile?.id);

  if (!ownedCourse.ok) {
    return { ok: false, message: ownedCourse.message };
  }

  if (
    !shortReason &&
    !basics.length &&
    !generalStudyMethod.length &&
    !courseStudyMethod.length &&
    !weeklyFocus.length
  ) {
    return { ok: false, message: "수정할 내용을 한 가지 이상 입력해 주세요." };
  }

  const proposedPatch = {
    ...(shortReason ? { shortReason } : {}),
    ...(basics.length ? { basics } : {}),
    ...(generalStudyMethod.length ? { generalStudyMethod } : {}),
    ...(courseStudyMethod.length ? { courseStudyMethod } : {}),
    ...(weeklyFocus.length ? { weeklyFocus } : {}),
  };

  const timestamp = new Date().toISOString();
  const { data, error } = await supabase
    .from("roadmap_revision_requests")
    .insert({
      scope: "course",
      status: "approved",
      course_code: ownedCourse.courseCode,
      course_id: ownedCourse.courseId,
      department_name: "법학과",
      title,
      summary: "담당 교수가 자기 과목 로드맵을 직접 수정했습니다.",
      proposed_by: profile?.id ?? null,
      proposed_by_name: profile?.name ?? ownedCourse.professorName ?? "교수",
      reviewed_by: profile?.id ?? null,
      reviewed_by_name: profile?.name ?? ownedCourse.professorName ?? "교수",
      approved_by: profile?.id ?? null,
      approved_by_name: profile?.name ?? ownedCourse.professorName ?? "교수",
      source_title: "교수 직접 수정",
      source_url: "/professor",
      proposed_patch: proposedPatch,
      reviewed_at: timestamp,
      approved_at: timestamp,
    })
    .select("id")
    .single();

  if (error) {
    return { ok: false, message: error.message };
  }

  await supabase.from("user_notifications").insert({
    recipient_role: "student",
    category: "revision",
    title: "담당 교수 로드맵 수정 반영",
    body: `${ownedCourse.courseCode} 과목 로드맵이 교수 수정본으로 업데이트됐습니다.`,
    target_href: "/roadmap",
  });

  revalidatePath("/professor");
  revalidatePath("/roadmap");
  revalidatePath("/admin");
  return { ok: true, message: `로드맵 수정이 바로 반영됐습니다. (${data.id.slice(0, 8)})` };
}

export async function addProfessorAdminTask(formData: FormData) {
  const professorId = text(formData.get("professorId"));
  const title = text(formData.get("title"));
  const day = integer(formData.get("dayOfWeek"), 1);
  const startTime = text(formData.get("startTime"), "09:00");
  const endTime = text(formData.get("endTime"), "10:00");

  if (!professorId) {
    return { ok: false, message: "교수 정보를 찾을 수 없습니다." };
  }

  const { error } = await supabase.from("professor_admin_tasks").insert({
    professor_id: professorId,
    title,
    day_of_week: day,
    start_time: startTime,
    end_time: endTime,
  });

  if (error) {
    return { ok: false, message: error.message };
  }

  revalidatePath("/professor");
  return { ok: true, message: "행정 업무가 추가됐습니다." };
}

export async function deleteProfessorAdminTask(formData: FormData) {
  const taskId = text(formData.get("taskId"));

  if (!taskId) return { ok: false, message: "작업 ID가 없습니다." };

  const { error } = await supabase.from("professor_admin_tasks").delete().eq("id", taskId);

  if (error) return { ok: false, message: error.message };

  revalidatePath("/professor");
  return { ok: true, message: "행정 업무가 삭제됐습니다." };
}

export async function toggleProfessorAvailability(formData: FormData) {
  const availabilityId = text(formData.get("availabilityId"));
  const isActive = formData.get("isActive") === "true";

  if (!availabilityId) return { ok: false, message: "일정 ID가 없습니다." };

  const { error } = await supabase
    .from("professor_availability")
    .update({ is_active: isActive })
    .eq("id", availabilityId);

  if (error) return { ok: false, message: error.message };

  revalidatePath("/professor");
  return { ok: true, message: "상담 가능 상태가 변경됐습니다." };
}
