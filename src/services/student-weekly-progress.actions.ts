"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getDemoProfile } from "@/services/session.service";
import {
  getApprovedCompanyLawContext,
} from "@/services/student-weekly-progress.server";
import {
  isStudentWeeklyProgressStatus,
  summarizeStudentCourseProgress,
} from "@/services/student-weekly-progress";
import type { StudentWeeklyProgressStatus } from "@/types/student-weekly-progress";

export type StudentWeeklyProgressActionResult = {
  ok: boolean;
  message: string;
};

function text(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

function optionalText(value: FormDataEntryValue | null) {
  return text(value) || null;
}

function parseLevel(value: FormDataEntryValue | null): number | null | "invalid" {
  const raw = text(value);
  if (!raw) return null;

  const level = Number(raw);
  return Number.isInteger(level) && level >= 1 && level <= 5 ? level : "invalid";
}

function parseStatus(value: FormDataEntryValue | null): StudentWeeklyProgressStatus | null {
  const raw = text(value);
  return isStudentWeeklyProgressStatus(raw) ? raw : null;
}

function failure(message: string): StudentWeeklyProgressActionResult {
  return { ok: false, message };
}

export async function updateStudentWeeklyProgress(
  formData: FormData,
): Promise<StudentWeeklyProgressActionResult> {
  const profile = await getDemoProfile();
  if (!profile) {
    return failure("학생 로그인이 필요합니다.");
  }

  if (profile.role !== "student") {
    return failure("학생만 학습 진행을 기록할 수 있습니다.");
  }

  const offeringId = text(formData.get("offeringId"));
  const weekNumber = Number(text(formData.get("weekNumber")));
  const status = parseStatus(formData.get("progressStatus"));
  const difficultyLevel = parseLevel(formData.get("difficultyLevel"));
  const understandingLevel = parseLevel(formData.get("understandingLevel"));

  if (!offeringId || !Number.isInteger(weekNumber) || !status) {
    return failure("주차와 진행 상태를 확인해 주세요.");
  }
  if (difficultyLevel === "invalid" || understandingLevel === "invalid") {
    return failure("난이도와 이해도는 1~5 범위로 입력해 주세요.");
  }

  const supabase = createSupabaseAdminClient();
  const context = await getApprovedCompanyLawContext(offeringId);
  if (!context || !context.plans.some((plan) => plan.weekNumber === weekNumber)) {
    return failure("승인된 회사법 주간 계획만 기록할 수 있습니다.");
  }

  const { error: weeklyError } = await supabase
    .from("student_weekly_progress")
    .upsert(
      {
        student_id: profile.id,
        offering_id: context.offeringId,
        week_number: weekNumber,
        progress_status_override: status,
        difficulty_level: difficultyLevel,
        understanding_level: understandingLevel,
        private_note: optionalText(formData.get("privateNote")),
        shared_feedback: optionalText(formData.get("sharedFeedback")),
        share_feedback_with_professor: text(formData.get("shareFeedbackWithProfessor")) === "true",
      },
      { onConflict: "student_id,offering_id,week_number" },
    );

  if (weeklyError) {
    return failure(`주차 진행 저장에 실패했습니다: ${weeklyError.message}`);
  }

  const { data: allRows, error: rowsError } = await supabase
    .from("student_weekly_progress")
    .select("week_number, progress_status_override")
    .eq("student_id", profile.id)
    .eq("offering_id", context.offeringId);

  if (rowsError) {
    return failure(`과목 진행 요약을 불러오지 못했습니다: ${rowsError.message}`);
  }

  const summary = summarizeStudentCourseProgress(
    (allRows ?? []).map((row) => ({
      weekNumber: row.week_number,
      progressStatusOverride: row.progress_status_override,
    })),
  );
  const { error: courseError } = await supabase
    .from("student_course_progress")
    .upsert(
      {
        student_id: profile.id,
        offering_id: context.offeringId,
        last_completed_week: summary.lastCompletedWeek,
        status: summary.status,
        last_activity_at: new Date().toISOString(),
      },
      { onConflict: "student_id,offering_id" },
    );

  if (courseError) {
    return failure(`과목 진행 요약 저장에 실패했습니다: ${courseError.message}`);
  }

  revalidatePath("/roadmap");
  revalidatePath("/dashboard");
  return { ok: true, message: "주차별 학습 진행을 저장했습니다." };
}
