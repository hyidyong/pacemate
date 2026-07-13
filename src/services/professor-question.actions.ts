"use server";

import { revalidatePath } from "next/cache";
import {
  normalizeProfessorQuestion,
  normalizeQuestionCategory,
} from "@/lib/professor-question-normalization";
import { normalizeUuid } from "@/lib/uuid";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createUserNotifications } from "@/services/notifications.create.service";
import { getAuthenticatedProfessorIdentity } from "@/services/professor-questions.server";

const INVALID_REQUEST_MESSAGE = "요청 정보를 확인해 주세요.";
const WRITE_FAILED_MESSAGE = "질문 설정을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.";
type ServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

function text(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

export async function answerProfessorQuestions(formData: FormData) {
  const identity = await getAuthenticatedProfessorIdentity();
  const answer = text(formData.get("answer"));
  const questionIds = formData
    .getAll("questionId")
    .flatMap((value) => (typeof value === "string" ? [normalizeUuid(value)] : []))
    .filter((value): value is string => Boolean(value));
  const uniqueQuestionIds = Array.from(new Set(questionIds));

  if (
    !identity ||
    !answer ||
    answer.length > 4000 ||
    uniqueQuestionIds.length < 1 ||
    uniqueQuestionIds.length > 50 ||
    uniqueQuestionIds.length !== formData.getAll("questionId").length
  ) {
    return { ok: false, message: INVALID_REQUEST_MESSAGE };
  }

  const { data, error } = await identity.supabase.rpc("answer_professor_questions", {
    p_question_ids: uniqueQuestionIds,
    p_answer: answer,
  });
  if (error || !Array.isArray(data) || data.length !== uniqueQuestionIds.length) {
    return { ok: false, message: WRITE_FAILED_MESSAGE };
  }

  const studentProfileIds = data.flatMap((row: unknown) => {
    if (!row || typeof row !== "object") return [];
    const value = (row as { student_profile_id?: unknown }).student_profile_id;
    const id = typeof value === "string" ? normalizeUuid(value) : null;
    return id ? [id] : [];
  });
  if (studentProfileIds.length !== uniqueQuestionIds.length) {
    return { ok: false, message: WRITE_FAILED_MESSAGE };
  }

  const notificationResult = await createUserNotifications(
    studentProfileIds.map((recipientId) => ({
      recipientRole: null,
      recipientId,
      category: "question" as const,
      title: "교수 답변 도착",
      body: "등록한 질문에 담당 교수의 답변이 도착했습니다.",
      targetHref: "/ask",
    })),
  );

  revalidatePath("/professor");
  revalidatePath("/ask");
  return notificationResult.ok
    ? { ok: true, message: `${uniqueQuestionIds.length}개 질문에 답변했습니다.` }
    : { ok: true, message: "답변은 저장됐지만 일부 알림 전송에 실패했습니다." };
}

export async function saveProfessorAutoReplyRule(formData: FormData) {
  const identity = await getAuthenticatedProfessorIdentity();
  if (!identity) return { ok: false, message: INVALID_REQUEST_MESSAGE };

  const ruleIdValue = text(formData.get("ruleId"));
  const ruleId = ruleIdValue ? normalizeUuid(ruleIdValue) : null;
  const courseIdValue = text(formData.get("courseId"));
  const courseId = courseIdValue ? normalizeUuid(courseIdValue) : null;
  const category = normalizeQuestionCategory(text(formData.get("category")));
  const pattern = text(formData.get("pattern"));
  const answer = text(formData.get("answer"));
  if (
    (ruleIdValue && !ruleId) ||
    (courseIdValue && !courseId) ||
    !category ||
    normalizeProfessorQuestion(pattern).length < 2 ||
    pattern.length > 200 ||
    !answer ||
    answer.length > 4000
  ) {
    return { ok: false, message: INVALID_REQUEST_MESSAGE };
  }

  if (courseId && !(await professorOwnsCourse(identity.supabase, identity.professorId, courseId))) {
    return { ok: false, message: INVALID_REQUEST_MESSAGE };
  }

  const values = {
    professor_id: identity.professorId,
    course_id: courseId,
    category,
    pattern,
    answer,
    updated_at: new Date().toISOString(),
  };
  const query = ruleId
    ? identity.supabase
        .from("professor_question_auto_reply_rules")
        .update(values)
        .eq("id", ruleId)
        .eq("professor_id", identity.professorId)
    : identity.supabase.from("professor_question_auto_reply_rules").insert(values);
  const { data, error } = await query.select("id").maybeSingle();
  if (error || !data) {
    return { ok: false, message: WRITE_FAILED_MESSAGE };
  }
  revalidatePath("/professor");
  return { ok: true, message: ruleId ? "자동 답변 규칙을 수정했습니다." : "자동 답변 규칙을 추가했습니다." };
}

export async function toggleProfessorAutoReplyRule(formData: FormData) {
  const identity = await getAuthenticatedProfessorIdentity();
  const ruleId = normalizeUuid(text(formData.get("ruleId")));
  const enabled = text(formData.get("enabled"));
  if (!identity || !ruleId || (enabled !== "true" && enabled !== "false")) {
    return { ok: false, message: INVALID_REQUEST_MESSAGE };
  }
  const { data, error } = await identity.supabase
    .from("professor_question_auto_reply_rules")
    .update({ is_enabled: enabled === "true", updated_at: new Date().toISOString() })
    .eq("id", ruleId)
    .eq("professor_id", identity.professorId)
    .select("id")
    .maybeSingle();
  if (error || !data) return { ok: false, message: WRITE_FAILED_MESSAGE };
  revalidatePath("/professor");
  return { ok: true, message: enabled === "true" ? "자동 답변 규칙을 켰습니다." : "자동 답변 규칙을 껐습니다." };
}

export async function deleteProfessorAutoReplyRule(formData: FormData) {
  const identity = await getAuthenticatedProfessorIdentity();
  const ruleId = normalizeUuid(text(formData.get("ruleId")));
  if (!identity || !ruleId) return { ok: false, message: INVALID_REQUEST_MESSAGE };
  const { data, error } = await identity.supabase
    .from("professor_question_auto_reply_rules")
    .delete()
    .eq("id", ruleId)
    .eq("professor_id", identity.professorId)
    .select("id")
    .maybeSingle();
  if (error || !data) return { ok: false, message: WRITE_FAILED_MESSAGE };
  revalidatePath("/professor");
  return { ok: true, message: "자동 답변 규칙을 삭제했습니다." };
}

async function professorOwnsCourse(
  supabase: ServerClient,
  professorId: string,
  courseId: string,
) {
  return queryProfessorCourse(supabase, professorId, courseId);
}

async function queryProfessorCourse(
  supabase: ServerClient,
  professorId: string,
  courseId: string,
) {
  const [{ data: mapping }, { data: offering }] = await Promise.all([
    supabase
      .from("course_professors")
      .select("course_id")
      .eq("professor_id", professorId)
      .eq("course_id", courseId)
      .limit(1),
    supabase
      .from("course_offerings")
      .select("course_id")
      .eq("professor_id", professorId)
      .eq("course_id", courseId)
      .limit(1),
  ]);
  return Boolean(mapping?.length || offering?.length);
}
