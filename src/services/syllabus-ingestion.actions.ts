"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getDemoProfile } from "@/services/session.service";
import { parseStoredSyllabus, uploadSyllabusFile } from "@/services/syllabus-ingestion.service";

export async function uploadProfessorSyllabus(formData: FormData) {
  const profile = await getDemoProfile();
  const courseId = typeof formData.get("courseId") === "string" ? String(formData.get("courseId")) : "";
  const file = formData.get("file");

  if (!profile || profile.role !== "professor") return { ok: false, message: "교수 권한이 필요합니다." };
  if (!courseId || !(file instanceof File)) return { ok: false, message: "과목과 PDF 강의계획서를 선택해 주세요." };

  const supabase = createSupabaseAdminClient();
  const { data: professor } = await supabase.from("professors").select("id").eq("profile_id", profile.id).maybeSingle();
  if (!professor) return { ok: false, message: "교수 정보를 찾을 수 없습니다." };

  const { data: offering } = await supabase
    .from("course_offerings")
    .select("id")
    .eq("course_id", courseId)
    .eq("professor_id", professor.id)
    .limit(1)
    .maybeSingle();
  if (!offering) return { ok: false, message: "담당 과목의 분반 정보를 찾을 수 없습니다." };

  try {
    const record = await uploadSyllabusFile(courseId, file, profile.id);
    revalidatePath("/professor");
    return { ok: true, syllabusId: record.id, status: record.parsingStatus, message: "강의계획서를 저장했습니다. 파싱 검토를 진행해 주세요." };
  } catch (error) {
    console.error("uploadProfessorSyllabus failed", error);
    return { ok: false, message: error instanceof Error ? error.message : "강의계획서 저장에 실패했습니다." };
  }
}

export async function parseProfessorSyllabus(formData: FormData) {
  const profile = await getDemoProfile();
  if (!profile || profile.role !== "professor") {
    return { ok: false, message: "Professor access is required" };
  }

  const syllabusId = String(formData.get("syllabusId") ?? "");
  if (!syllabusId) return { ok: false, message: "Syllabus id is required" };

  try {
    const supabase = createSupabaseAdminClient();
    const { data: syllabus } = await supabase
      .from("syllabi")
      .select("id,course_id,uploaded_by")
      .eq("id", syllabusId)
      .maybeSingle();
    if (!syllabus || syllabus.uploaded_by !== profile.id) {
      return { ok: false, message: "You can only parse your own syllabus" };
    }

    const { data: professor } = await supabase
      .from("professors")
      .select("id")
      .eq("profile_id", profile.id)
      .maybeSingle();
    const { data: offering } = professor
      ? await supabase
          .from("course_offerings")
          .select("id")
          .eq("course_id", syllabus.course_id)
          .eq("professor_id", professor.id)
          .limit(1)
          .maybeSingle()
      : { data: null };
    if (!offering) {
      return { ok: false, message: "This syllabus is not assigned to your course offering" };
    }

    const record = await parseStoredSyllabus(syllabusId);
    revalidatePath("/professor");
    return { ok: true, syllabusId: record.id, status: record.parsingStatus };
  } catch (error) {
    console.error("parseProfessorSyllabus failed", error);
    return { ok: false, message: error instanceof Error ? error.message : "Syllabus parsing failed" };
  }
}
