"use server";

import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase/client";
import { getDemoProfile } from "@/services/session.service";

export async function submitQuestionToProfessor(formData: FormData) {
  const profile = await getDemoProfile();
  if (!profile) {
    return { ok: false, message: "로그인이 필요합니다." };
  }

  const courseId = formData.get("courseId")?.toString();
  const professorId = formData.get("professorId")?.toString();
  const question = formData.get("question")?.toString();

  if (!courseId || !professorId || !question) {
    return { ok: false, message: "과목, 교수, 질문 내용을 모두 입력해 주세요." };
  }

  // We insert it into FAQs but without an answer, to mark it as pending question
  const { error } = await supabase.from("faqs").insert({
    professor_id: professorId,
    course_id: courseId,
    question: `[${profile.name}] ${question}`,
    answer: "",
    category: "미답변 질문",
  });

  if (error) {
    return { ok: false, message: error.message };
  }

  revalidatePath("/professor");
  return { ok: true, message: "질문이 교수님/조교님께 성공적으로 전달되었습니다." };
}
