"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getDemoProfile } from "@/services/session.service";

function value(formData: FormData, key: string, maxLength = 4000) {
  const raw = formData.get(key);
  return typeof raw === "string" ? raw.trim().slice(0, maxLength) : "";
}

function keywords(value: string) {
  return [...new Set(value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean))].slice(0, 12);
}

export async function saveProfessorRoadmapPersonalization(formData: FormData) {
  const profile = await getDemoProfile();
  if (!profile || profile.role !== "professor") return { message: "교수 권한이 필요합니다." };
  const courseId = value(formData, "courseId", 100);
  if (!courseId) return { message: "과목을 선택해 주세요." };

  const supabase = createSupabaseAdminClient();
  const { data: professor } = await supabase.from("professors").select("id").eq("profile_id", profile.id).maybeSingle();
  if (!professor) return { message: "교수 정보를 확인할 수 없습니다." };
  const { data: offering } = await supabase.from("course_offerings").select("id").eq("course_id", courseId).eq("professor_id", professor.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!offering) return { message: "담당 분반을 찾을 수 없습니다." };

  const { data: existing } = await supabase.from("course_roadmap_personalization_sources").select("source_version").eq("offering_id", offering.id).maybeSingle();
  const { error } = await supabase.from("course_roadmap_personalization_sources").upsert({
    offering_id: offering.id,
    professor_id: professor.id,
    foundation_knowledge: value(formData, "foundationKnowledge"),
    focus_keywords: keywords(value(formData, "focusKeywords")),
    professor_notes: value(formData, "professorNotes"),
    source_version: (existing?.source_version ?? 0) + 1,
  }, { onConflict: "offering_id" });
  if (error) return { message: "로드맵 설정 저장에 실패했습니다." };

  revalidatePath("/professor");
  revalidatePath("/roadmap");
  return { message: "학생 로드맵에 반영했습니다. 다음 조회 시 최신 개인화 계획이 생성됩니다." };
}
