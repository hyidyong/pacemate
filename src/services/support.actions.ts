"use server";

import { revalidatePath } from "next/cache";
import { createUserNotification } from "@/services/notifications.create.service";
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

/**
 * Stage 9 — the anonymous support boundary.
 *
 * /support is deliberately reachable without a session, and that is preserved.
 * What is NOT preserved is the shape of the old boundary:
 *
 *   before:  anonymous browser -> INSERT into user_notifications with a
 *            caller-chosen recipient_id, recipient_role, school_id,
 *            target_href, category, title and body
 *   after:   anonymous browser -> this validated server action -> a
 *            notification whose every routing field is a constant chosen here
 *
 * The anon INSERT policy the old shape depended on is gone (20260814010000),
 * and no client role holds INSERT on `user_notifications` at all, so the only
 * way to create one is through server code that has already decided what it is
 * creating. The caller controls exactly two things — a title and a body — and
 * both are length-bounded before they are stored.
 *
 * Anti-abuse is deliberately bounded to what can be enforced correctly here:
 * length caps and a fixed low-trust routing shape. Per-IP throttling is NOT
 * added — university traffic arrives through campus NAT, so an IP is not a
 * caller (the same reasoning as KI-021), and an in-memory limiter on serverless
 * is per-instance theatre. A volume control belongs with a shared store, which
 * this stage does not introduce.
 */
const SUPPORT_TITLE_MAX = 120;
const SUPPORT_MESSAGE_MAX = 500;

export async function submitSupportInquiry(formData: FormData) {
  const profile = await getDemoProfile();
  const title = text(formData.get("title")).slice(0, SUPPORT_TITLE_MAX);
  const message = text(formData.get("message"));
  const category = text(formData.get("category"), "system");

  if (!title || message.length < 8) {
    return { ok: false, message: "문의 제목과 내용을 조금 더 구체적으로 적어 주세요." };
  }

  if (message.length > 4000) {
    return { ok: false, message: "문의 내용은 4000자 이내로 작성해 주세요." };
  }

  const autoReply = getAutoReply(`${title} ${message}`);
  if (autoReply) {
    return { ok: true, autoReplied: true, message: autoReply };
  }

  // Every routing field below is a constant. An anonymous submission is
  // labelled as such rather than borrowing a name it cannot prove, and it is
  // addressed to the admin role — never to a recipient the caller names.
  const submitter = profile?.name ?? "비로그인 사용자";
  const notificationResult = await createUserNotification({
    recipientRole: "admin",
    recipientId: null,
    category: "system",
    title: `운영 문의: ${title}`,
    body: `[${category}] ${submitter}: ${message.slice(0, SUPPORT_MESSAGE_MAX)}`,
    targetHref: "/admin",
    // A signed-in submitter's inquiry reaches their own university's admins; an
    // anonymous one has no tenant to claim and stays untenanted, which the
    // Stage 8 read predicate already handles (NULL school_id matches nothing,
    // so it is visible only through the server-side admin surface).
    schoolId: profile?.school_id ?? null,
  });

  if (!notificationResult.ok) {
    return { ok: false, message: notificationResult.message };
  }

  revalidatePath("/admin");
  revalidatePath("/notifications");

  return {
    ok: true,
    autoReplied: false,
    message: "문의가 접수됐습니다. 운영 시간 09:00~17:00 안에서 순차 확인됩니다.",
  };
}
