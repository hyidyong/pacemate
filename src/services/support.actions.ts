"use server";

import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase/client";
import { getDemoProfile } from "@/services/session.service";

function text(value: FormDataEntryValue | null, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function getAutoReply(message: string) {
  if (/로그인|계정|비밀번호|권한/.test(message)) {
    return "로그인 문제는 온보딩에서 역할을 다시 선택한 뒤 테스트 계정으로 재시도해 주세요. 관리자 계정은 별도 로그인 키가 필요합니다.";
  }

  if (/상담|예약|시간/.test(message)) {
    return "상담 예약은 과목별 예약 또는 교수별 검색으로 교수님을 먼저 선택한 뒤, 캘린더에서 가능한 날짜와 시간을 고르면 됩니다.";
  }

  if (/로드맵|추천|수강/.test(message)) {
    return "로드맵 상세 화면 하단의 간단 수정 요청으로 과목별 오류를 보낼 수 있습니다. 운영자가 검토한 뒤 반영 여부를 결정합니다.";
  }

  return "";
}

export async function submitSupportInquiry(formData: FormData) {
  const profile = await getDemoProfile();
  const title = text(formData.get("title"));
  const message = text(formData.get("message"));
  const category = text(formData.get("category"), "system");

  if (!title || message.length < 8) {
    return { ok: false, message: "문의 제목과 내용을 조금 더 구체적으로 적어 주세요." };
  }

  const autoReply = getAutoReply(`${title} ${message}`);
  if (autoReply) {
    return { ok: true, autoReplied: true, message: autoReply };
  }

  const { error } = await supabase.from("user_notifications").insert({
    recipient_role: "admin",
    category: "system",
    title: `운영 문의: ${title}`,
    body: `[${category}] ${profile?.name ?? "사용자"}: ${message.slice(0, 500)}`,
    target_href: "/admin",
  });

  if (error) {
    return { ok: false, message: error.message };
  }

  revalidatePath("/admin");
  revalidatePath("/notifications");

  return {
    ok: true,
    autoReplied: false,
    message: "문의가 접수됐습니다. 운영 시간 09:00~17:00 안에서 순차 확인됩니다.",
  };
}
