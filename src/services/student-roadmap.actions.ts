"use server";

import { revalidatePath } from "next/cache";
import { getPersonalizedWeeklyRoadmapForSession } from "@/services/personalized-weekly-roadmap.server";

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
