"use server";

import { revalidatePath } from "next/cache";
import { getPersonalizedWeeklyRoadmapForSession } from "@/services/personalized-weekly-roadmap.server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireDemoSession } from "@/lib/auth/demo-session";

export async function generateStudentPersonalizedRoadmap(offeringId: string) {
  if (!offeringId) return { ok: false, message: "과목을 선택해 주세요." };
  try {
    await getPersonalizedWeeklyRoadmapForSession(offeringId);
    revalidatePath("/roadmap");
    return { ok: true, message: "개인 맞춤 로드맵을 생성했습니다." };
  } catch {
    return { ok: false, message: "로드맵 생성에 실패했습니다. 잠시 후 다시 시도해 주세요." };
  }
}

export async function saveStudentRoadmapWeekProgress(offeringId: string, weekNumber: number) {
  const session = await requireDemoSession();
  if (session.role !== "student" || !offeringId || weekNumber < 1 || weekNumber > 15) {
    return { ok: false, message: "유효한 과목과 주차를 선택해 주세요." };
  }
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.from("student_weekly_progress").upsert({
    student_id: session.profileId,
    offering_id: offeringId,
    week_number: weekNumber,
    progress_status_override: "covered",
  }, { onConflict: "student_id,offering_id,week_number" });
  if (error) return { ok: false, message: "진행 저장에 실패했습니다. 잠시 후 다시 시도해 주세요." };
  revalidatePath("/roadmap");
  revalidatePath("/dashboard");
  return { ok: true, message: `${weekNumber}주차 진행을 저장했습니다.` };
}
