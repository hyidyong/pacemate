"use server";

import { revalidatePath } from "next/cache";
import {
  normalizeQuestionCategory,
  validateProfessorQuestion,
} from "@/lib/professor-question-normalization";
import { normalizeUuid } from "@/lib/uuid";
import { createProfessorQuestionRecord } from "@/services/professor-questions.server";

const INVALID_QUESTION_MESSAGE = "질문 정보를 확인해 주세요.";
const QUESTION_FAILED_MESSAGE = "질문을 전달하지 못했습니다. 잠시 후 다시 시도해 주세요.";

function text(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

function boolean(value: FormDataEntryValue | null) {
  return value === "true";
}

export async function submitQuestionToProfessor(formData: FormData) {
  const courseId = normalizeUuid(text(formData.get("courseId")));
  const category = normalizeQuestionCategory(text(formData.get("category")));
  const question = validateProfessorQuestion(text(formData.get("question")));
  const submissionKey = normalizeUuid(text(formData.get("submissionKey")));
  const isAnonymous = boolean(formData.get("isAnonymous"));

  if (!courseId || !category || !question || !submissionKey) {
    return { ok: false, message: INVALID_QUESTION_MESSAGE };
  }

  const result = await createProfessorQuestionRecord({
    courseId,
    category,
    question,
    submissionKey,
    sourceMessageId: null,
    sourceKind: "direct",
    isAnonymous,
  });
  if (!result.ok) {
    return {
      ok: false,
      message: result.code === "route_not_found" ? "담당 교수를 안전하게 확인할 수 없습니다." : QUESTION_FAILED_MESSAGE,
    };
  }

  revalidatePath("/ask");
  revalidatePath("/professor");
  revalidatePath("/dashboard");
  revalidatePath("/mypage");
  if (!result.notificationDelivered) {
    return { ok: true, message: "질문은 접수됐지만 알림 전송에 실패했습니다." };
  }
  if (!result.created) {
    return { ok: true, message: "이미 접수된 질문입니다." };
  }
  return {
    ok: true,
    message: result.status === "answered" ? "질문이 접수되어 자동 답변이 등록됐습니다." : "질문을 담당 교수와 조교에게 전달했습니다.",
  };
}

export async function escalateTutorQuestion(formData: FormData) {
  const courseId = normalizeUuid(text(formData.get("courseId")));
  const category = normalizeQuestionCategory(text(formData.get("category")));
  const sourceMessageId = normalizeUuid(text(formData.get("sourceMessageId")));

  if (!courseId || !category || !sourceMessageId) {
    return { ok: false, message: INVALID_QUESTION_MESSAGE };
  }

  const result = await createProfessorQuestionRecord({
    courseId,
    category,
    question: "",
    submissionKey: sourceMessageId,
    sourceMessageId,
    sourceKind: "tutor",
    isAnonymous: boolean(formData.get("isAnonymous")),
  });
  if (!result.ok) {
    return {
      ok: false,
      message: result.code === "route_not_found" ? "담당 교수를 안전하게 확인할 수 없습니다." : QUESTION_FAILED_MESSAGE,
    };
  }

  revalidatePath("/ask");
  revalidatePath("/professor");
  revalidatePath("/dashboard");
  revalidatePath("/mypage");
  if (!result.notificationDelivered) {
    return { ok: true, message: "질문은 접수됐지만 알림 전송에 실패했습니다." };
  }
  return { ok: true, message: result.created ? "튜터 질문을 담당 교수에게 전달했습니다." : "이미 접수된 질문입니다." };
}
