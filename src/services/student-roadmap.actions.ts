"use server";

import { revalidatePath } from "next/cache";
import { getPersonalizedWeeklyRoadmapForSession } from "@/services/personalized-weekly-roadmap.server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getDemoProfile } from "@/services/session.service";
import type { StudentDifficultyRating } from "@/types/student-weekly-progress";

export type StudentWeeklyFeedbackInput = {
  difficultyRating: StudentDifficultyRating | null;
  personalMemo: string;
  professorMemo: string;
};

const MAX_WEEKLY_MEMO_LENGTH = 2000;

function isDifficultyRating(value: unknown): value is StudentDifficultyRating {
  return value === "HIGH" || value === "MID" || value === "LOW";
}

function isMissingWeeklyFeedbackSchema(error: { code?: string; message?: string } | null) {
  return error?.code === "PGRST204"
    || error?.code === "42703"
    || /difficulty_rating|professor_memo/i.test(error?.message ?? "");
}

function createStudentRoadmapActionSupabaseClient() {
  try {
    return createSupabaseAdminClient();
  } catch (error) {
    console.error("Student roadmap action Supabase admin client is unavailable", error);
    return null;
  }
}

export async function generateStudentPersonalizedRoadmap(offeringId: string) {
  if (!offeringId) return { ok: false, message: "과목을 선택해 주세요." };
  try {
    await getPersonalizedWeeklyRoadmapForSession(offeringId);
    revalidatePath("/roadmap");
    return { ok: true, message: "개인 맞춤 로드맵을 생성했습니다." };
  } catch (error) {
    return { ok: false, message: "로드맵 생성에 실패했습니다. 잠시 후 다시 시도해 주세요." };
  }
}

export async function saveStudentRoadmapWeekProgress(
  offeringId: string,
  weekNumber: number,
  feedback?: StudentWeeklyFeedbackInput,
) {
  const profile = await getDemoProfile();
  if (profile?.role !== "student" || !offeringId || weekNumber < 1 || weekNumber > 15) {
    return { ok: false, message: "유효한 과목과 주차를 선택해 주세요." };
  }
  if (feedback && feedback.difficultyRating !== null && !isDifficultyRating(feedback.difficultyRating)) {
    return { ok: false, message: "난이도는 상, 중, 하 중 하나를 선택해 주세요." };
  }

  const personalMemo = feedback?.personalMemo.trim() ?? "";
  const professorMemo = feedback?.professorMemo.trim() ?? "";
  if (personalMemo.length > MAX_WEEKLY_MEMO_LENGTH || professorMemo.length > MAX_WEEKLY_MEMO_LENGTH) {
    return { ok: false, message: "메모는 각각 2,000자 이내로 작성해 주세요." };
  }

  const supabase = createStudentRoadmapActionSupabaseClient();
  if (!supabase) {
    return { ok: false, message: "로드맵 데이터베이스 설정을 확인해 주세요." };
  }

  const { data: enrollment, error: enrollmentError } = await supabase
    .from("student_courses")
    .select("id")
    .eq("student_id", profile.id)
    .eq("offering_id", offeringId)
    .limit(1)
    .maybeSingle();
  if (enrollmentError || !enrollment) {
    return { ok: false, message: "시간표에 등록된 본인 과목만 저장할 수 있습니다." };
  }

  const difficultyLevel = feedback?.difficultyRating === "HIGH"
    ? 5
    : feedback?.difficultyRating === "MID"
      ? 3
      : feedback?.difficultyRating === "LOW"
        ? 1
        : null;
  const feedbackColumns = feedback
    ? {
        difficulty_rating: feedback.difficultyRating,
        difficulty_level: difficultyLevel,
        private_note: personalMemo || null,
        professor_memo: professorMemo || null,
        shared_feedback: professorMemo || null,
        share_feedback_with_professor: Boolean(professorMemo),
      }
    : {};
  const baseRow = {
    student_id: profile.id,
    offering_id: offeringId,
    week_number: weekNumber,
    progress_status_override: "covered",
  };
  const { error } = await supabase.from("student_weekly_progress").upsert(
    { ...baseRow, ...feedbackColumns },
    { onConflict: "student_id,offering_id,week_number" },
  );
  if (error && feedback && isMissingWeeklyFeedbackSchema(error)) {
    const { difficulty_rating: _difficultyRating, professor_memo: _professorMemo, ...legacyFeedback } = feedbackColumns;
    const { error: legacyError } = await supabase.from("student_weekly_progress").upsert(
      { ...baseRow, ...legacyFeedback },
      { onConflict: "student_id,offering_id,week_number" },
    );
    if (legacyError) {
      return { ok: false, message: "학습 상태 저장에 실패했습니다. 잠시 후 다시 시도해 주세요." };
    }
  } else if (error) {
    return { ok: false, message: "학습 상태 저장에 실패했습니다. 잠시 후 다시 시도해 주세요." };
  }
  try {
    await getPersonalizedWeeklyRoadmapForSession(offeringId);
  } catch (regenerationError) {
    console.error("Student roadmap progress regeneration failed", regenerationError);
  }
  revalidatePath("/roadmap");
  revalidatePath("/dashboard");
  revalidatePath("/professor");
  return {
    ok: true,
    message: feedback
      ? `${weekNumber}주차 진행도와 학습 피드백을 저장했습니다.`
      : `${weekNumber}주차 진행을 저장하고 개인화 로드맵을 갱신했습니다.`,
  };
}
