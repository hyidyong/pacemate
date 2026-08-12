"use server";

import { revalidatePath } from "next/cache";
// The demo schema grants professor_availability/faqs writes to the anon role
// only (see supabase/schema.sql "demo anon manage ..." policies), so those
// writes must keep using the anon browser client until a migration adds
// authenticated write policies for them.
import { supabase as anonSupabase } from "@/lib/supabase/client";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createUserNotification } from "@/services/notifications.create.service";
import {
  dateKeyToLocalDate,
  getDayOfWeek,
  timeRangeEndsByStudentCutoff,
} from "@/lib/counseling-slots";
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

export async function updateProfessorProfile(formData: FormData) {
  const profile = await getDemoProfile();

  if (profile?.role !== "professor") {
    return { ok: false, message: "교수 계정으로만 프로필을 수정할 수 있습니다.", professor: null };
  }

  const office = text(formData.get("office")) || null;
  const email = text(formData.get("email")) || null;
  const bio = text(formData.get("bio")) || null;

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, message: "이메일 형식을 확인해 주세요.", professor: null };
  }

  if ((office?.length ?? 0) > 120 || (email?.length ?? 0) > 255 || (bio?.length ?? 0) > 1000) {
    return { ok: false, message: "입력한 내용의 길이를 확인해 주세요.", professor: null };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("professors")
    .update({ office, email, bio })
    .eq("profile_id", profile.id)
    .select("id, name, office, email, bio, department:departments(name)")
    .maybeSingle();

  if (error || !data) {
    return { ok: false, message: "프로필을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.", professor: null };
  }

  revalidatePath("/professor");
  revalidatePath("/professor/mypage");
  return { ok: true, message: "프로필을 저장했습니다.", professor: data };
}

async function getCurrentProfessorForAction(profileId?: string | null) {
  if (!profileId) {
    return null;
  }

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("professors")
    .select("id, name")
    .eq("profile_id", profileId)
    .maybeSingle();

  return data;
}

// Stage 6: the set of counseling requests a professor/assistant may mutate is
// bounded by tenant. A professor may touch only their own professor's requests
// (also closing the KI-014 ownership hole for this path); an assistant may
// touch any professor's request WITHIN their own school. Returns the
// professor_id filter to constrain the write, or null to fail closed (no
// tenant, or a professor with no linked professors row — replacing the old
// first-row fallback for this action, AUDIT X4/X12).
async function resolveCounselingWriteProfessorIds(
  profile: { id: string; role: string; school_id: string | null } | null,
): Promise<string[] | null> {
  const tenantId = profile?.school_id;
  if (!profile || !tenantId) {
    return null;
  }

  if (profile.role === "professor") {
    const professor = await getCurrentProfessorForAction(profile.id);
    return professor?.id ? [professor.id] : null;
  }

  // assistant (already role-gated by the caller): every professor in the tenant.
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("professors")
    .select("id")
    .eq("school_id", tenantId);

  if (error) {
    return null;
  }

  const ids = (data ?? []).map((row) => row.id as string);
  return ids.length ? ids : null;
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

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("course_professors")
    .select("course_id")
    .eq("professor_id", professor.id)
    .eq("course_id", courseId)
    .maybeSingle();

  if (error) {
    return { ok: false as const, message: "과목 권한을 확인하지 못했습니다." };
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
  try {
    const professorId = text(formData.get("professorId"));
    const day = integer(formData.get("dayOfWeek"), 1);
    const specificDate = text(formData.get("specificDate"));
    const startTime = text(formData.get("startTime"), "10:00");
    const endTime = text(formData.get("endTime"), "12:00");
    const slotMinutes = integer(formData.get("slotMinutes"), 30);
    const isActive = formData.get("isActive") === "false" ? false : true;

    if (!professorId) {
      return { ok: false, message: "교수 정보를 찾을 수 없습니다." };
    }

    if (specificDate) {
      const date = dateKeyToLocalDate(specificDate);
      const dayOfWeek = date ? getDayOfWeek(date) : -1;
      if (dayOfWeek < 1 || dayOfWeek > 5) {
        return { ok: false, message: "상담 가능 시간은 평일에만 등록할 수 있습니다." };
      }
    } else if (day < 1 || day > 5) {
      return { ok: false, message: "상담 가능 시간은 평일에만 등록할 수 있습니다." };
    }

    if (!timeRangeEndsByStudentCutoff(startTime, endTime)) {
      return { ok: false, message: "상담 가능 시간은 18:00 이전으로만 등록할 수 있습니다." };
    }

    const { error } = await anonSupabase.from("professor_availability").insert({
      professor_id: professorId,
      day_of_week: day,
      specific_date: specificDate || null,
      start_time: startTime,
      end_time: endTime,
      slot_minutes: slotMinutes,
      is_active: isActive,
    });

    if (error) {
      return { ok: false, message: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." };
    }

    revalidatePath("/professor");
    return { ok: true, message: "상담 가능 시간이 추가됐습니다." };
  } catch (err: any) {
    console.error("Action error:", err);
      return { ok: false, message: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }
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

  const { error } = await anonSupabase.from("faqs").insert({
    professor_id: professorId,
    course_id: courseId || null,
    question,
    answer: `${prefix}${answer}`,
    category: "교수 답변",
    approved_at: new Date().toISOString(),
  });

  if (error) {
      return { ok: false, message: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }

  revalidatePath("/professor");
  return { ok: true, message: "FAQ 답변을 저장했습니다." };
}

// Legal status transitions (Stage 5, matrix M4/M5): rejected and cancelled
// are terminal, and `pending` is never a target — no UI ever sends it, and it
// was the resurrection vector that could re-consume a slot someone else
// re-booked. The from-state predicate makes each transition a compare-and-set:
// competing updates on one request resolve to exactly one winner.
const LEGAL_TRANSITION_SOURCES: Record<string, string[]> = {
  approved: ["pending"],
  rejected: ["pending"],
  cancelled: ["pending", "approved"],
};

const COUNSELING_STATUS_CONFLICT_MESSAGE =
  "이미 처리된 상담 신청입니다. 최신 상태를 확인해 주세요.";

export async function updateCounselingStatus(formData: FormData) {
  const profile = await getDemoProfile();
  if (profile?.role !== "professor" && profile?.role !== "assistant") {
    return { ok: false, message: "교수 계정으로만 상담 요청을 처리할 수 있습니다." };
  }

  const requestId = text(formData.get("requestId"));
  const status = text(formData.get("status"));
  const professorNote = text(formData.get("professorNote"));
  const suggestedStart = text(formData.get("suggestedStart"));
  const suggestedEnd = text(formData.get("suggestedEnd"));

  const allowedFromStatuses = LEGAL_TRANSITION_SOURCES[status];
  if (!requestId || !allowedFromStatuses) {
    return { ok: false, message: "상담 요청을 처리할 수 없습니다." };
  }

  if (status === "rejected" && (!professorNote || !suggestedStart)) {
    return { ok: false, message: "거절 사유와 추천 시간대를 입력해 주세요." };
  }

  // Stage 6: constrain the write to the caller's own tenant (and, for a
  // professor, their own requests). A foreign-tenant requestId simply matches
  // zero rows and returns the same controlled conflict as a lost CAS race.
  const writableProfessorIds = await resolveCounselingWriteProfessorIds(profile);
  if (!writableProfessorIds) {
    return { ok: false, message: COUNSELING_STATUS_CONFLICT_MESSAGE };
  }

  // Service role with the app-level role guard above: neither anon (select
  // revoked) nor authenticated (legacy auth.uid()=profiles.id policy) can
  // complete this update on the current schema.
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("counseling_requests")
    .update({
      status,
      professor_note: professorNote || null,
      suggested_start: suggestedStart || null,
      suggested_end: suggestedEnd || null,
    })
    .eq("id", requestId)
    .in("professor_id", writableProfessorIds)
    .in("status", allowedFromStatuses)
    .select("id, student_id, topic, requested_start, suggested_start")
    .single();

  if (error) {
    // 0 rows matched (PGRST116): a competing transition won, or the request
    // no longer exists — the workspace's data changed underneath this client.
    // 23P01 is the DB exclusion constraint defending a (now target-less)
    // resurrection into a re-booked slot; same controlled outcome.
    if (error.code === "PGRST116" || error.code === "23P01") {
      revalidatePath("/professor");
      revalidatePath("/counseling");
      return { ok: false, message: COUNSELING_STATUS_CONFLICT_MESSAGE };
    }
    return { ok: false, message: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }

  const notificationCopy =
    status === "approved"
      ? {
          title: "상담 신청이 승인됐습니다",
          body: professorNote || `${data.topic} 상담 신청이 승인됐습니다.`,
        }
      : status === "cancelled"
        ? {
            title: "상담 예약이 취소됐습니다",
            body:
              professorNote ||
              `${data.topic} 상담 예약이 취소됐습니다. 다른 시간으로 다시 신청할 수 있습니다.`,
          }
        : {
            title: "상담 시간이 조정 필요합니다",
            body: `${professorNote} 추천 시간으로 다시 예약할 수 있습니다.`,
          };

  const notificationResult = await createUserNotification({
    recipientRole: "student",
    recipientId: data.student_id,
    category: "counseling",
    title: notificationCopy.title,
    body: notificationCopy.body,
    targetHref: "/counseling",
  });

  revalidatePath("/professor");
  revalidatePath("/counseling");

  if (!notificationResult.ok) {
    return { ok: true, message: "상담 상태는 변경됐지만 알림 전송에 실패했습니다." };
  }

  return { ok: true, message: "상담 상태를 변경했습니다." };
}

export async function updateCounselingDetails(formData: FormData) {
  const profile = await getDemoProfile();
  if (profile?.role !== "professor" && profile?.role !== "assistant") {
    return { ok: false, message: "교수 계정으로만 상담 일정을 수정할 수 있습니다." };
  }

  const requestId = text(formData.get("requestId"));
  const professorNote = text(formData.get("professorNote"));
  const location = text(formData.get("location"));

  if (!requestId) {
    return { ok: false, message: "상담 일정을 찾을 수 없습니다." };
  }

  // Stage 6: same tenant/ownership scope as updateCounselingStatus so a
  // foreign-tenant requestId cannot have its note/location rewritten
  // (AUDIT X4). This UPDATE has no CAS, so the ownership predicate IS its
  // whole authorization.
  const writableProfessorIds = await resolveCounselingWriteProfessorIds(profile);
  if (!writableProfessorIds) {
    return { ok: false, message: "상담 일정을 수정할 수 없습니다." };
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("counseling_requests")
    .update({
      professor_note: professorNote || null,
      location: location || null,
    })
    .eq("id", requestId)
    .in("professor_id", writableProfessorIds)
    .select("id")
    .maybeSingle();

  if (error) {
      return { ok: false, message: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }

  if (!data) {
    return { ok: false, message: "상담 일정을 수정할 수 없습니다. 최신 상태를 확인해 주세요." };
  }

  revalidatePath("/professor");
  revalidatePath("/counseling");
  return { ok: true, message: "상담 일정이 저장되었습니다." };
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

  const supabase = await createSupabaseServerClient();
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
    return { ok: false, message: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }

  const notificationResult = await createUserNotification({
    recipientRole: "admin",
    recipientId: null,
    category: "revision",
    title: "로드맵 수정 승인 요청",
    body: `${title} 요청이 관리자 승인을 기다립니다.`,
    targetHref: `/admin?request=${data.id}`,
  });

  revalidatePath("/professor");
  revalidatePath("/admin");

  if (!notificationResult.ok) {
    return { ok: true, message: "로드맵 수정 요청은 접수됐지만 알림 전송에 실패했습니다." };
  }

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
  const supabase = await createSupabaseServerClient();
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
    return { ok: false, message: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }

  const notificationResult = await createUserNotification({
    recipientRole: "student",
    recipientId: null,
    category: "revision",
    title: "담당 교수 로드맵 수정 반영",
    body: `${ownedCourse.courseCode} 과목 로드맵이 교수 수정본으로 업데이트됐습니다.`,
    targetHref: "/roadmap",
  });

  revalidatePath("/professor");
  revalidatePath("/roadmap");
  revalidatePath("/admin");

  if (!notificationResult.ok) {
    return { ok: true, message: "로드맵 수정은 반영됐지만 알림 전송에 실패했습니다." };
  }

  return { ok: true, message: `로드맵 수정이 바로 반영됐습니다. (${data.id.slice(0, 8)})` };
}

export async function addProfessorAdminTask(formData: FormData) {
  try {
    const profile = await getDemoProfile();
    if (profile?.role !== "professor") {
      return { ok: false, message: "교수 계정만 행정 일정을 관리할 수 있습니다." };
    }

    const professorId = text(formData.get("professorId"));
    const title = text(formData.get("title"));
    const day = integer(formData.get("dayOfWeek"), 1);
    const startTime = text(formData.get("startTime"), "09:00");
    const endTime = text(formData.get("endTime"), "10:00");

    if (!professorId) {
      return { ok: false, message: "교수 정보를 찾을 수 없습니다." };
    }

    const supabase = await createSupabaseServerClient();
    const { data: professor } = await supabase
      .from("professors")
      .select("id")
      .eq("id", professorId)
      .eq("profile_id", profile.id)
      .maybeSingle();

    if (!professor) {
      return { ok: false, message: "본인의 일정만 관리할 수 있습니다." };
    }

    if (title.startsWith("__BLACKOUT__") && !timeRangeEndsByStudentCutoff(startTime, endTime)) {
      return { ok: false, message: "상담 차단은 18:00 이전 시간대에만 적용할 수 있습니다." };
    }

    const { error } = await supabase.from("professor_admin_tasks").insert({
      professor_id: professorId,
      title,
      day_of_week: day,
      start_time: startTime,
      end_time: endTime,
    });

    if (error) {
    return { ok: false, message: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." };
    }

    revalidatePath("/professor");
    return { ok: true, message: "행정 업무가 추가됐습니다." };
  } catch (err: any) {
    console.error("Action error:", err);
    return { ok: false, message: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }
}

export async function deleteProfessorAdminTask(formData: FormData) {
  try {
    const profile = await getDemoProfile();
    if (profile?.role !== "professor") {
      return { ok: false, message: "교수 계정만 행정 일정을 관리할 수 있습니다." };
    }

    const id = text(formData.get("id"));
    if (!id) return { ok: false, message: "ID 누락" };

    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.from("professor_admin_tasks").delete().eq("id", id);
    if (error) return { ok: false, message: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." };

    revalidatePath("/professor");
    return { ok: true, message: "행정 업무가 삭제됐습니다." };
  } catch (err: any) {
    console.error("Action error:", err);
    return { ok: false, message: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }
}

export async function toggleProfessorAvailability(formData: FormData) {
  try {
    const id = text(formData.get("id"));
    const isActive = text(formData.get("isActive")) === "true";

    if (!id) return { ok: false, message: "ID 누락" };

    const { error } = await anonSupabase
      .from("professor_availability")
      .update({ is_active: isActive })
      .eq("id", id);

    if (error) return { ok: false, message: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." };

    revalidatePath("/professor");
    return { ok: true, message: isActive ? "상담 가능 상태로 변경됐습니다." : "상담 불가 상태로 변경됐습니다." };
  } catch (err: any) {
    console.error("Action error:", err);
    return { ok: false, message: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }
}
