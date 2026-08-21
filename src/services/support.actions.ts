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
 * Stage 9 — the support boundary. SUPPORT REQUIRES A SESSION.
 *
 * Codex round 3, F8: the previous shape was internally contradictory. The page
 * already gated itself — `/support` calls requireRoles(profile, [student,
 * professor, assistant, admin]), so an anonymous visitor is redirected to login
 * and can never reach the form — while this action still accepted anonymous
 * submissions and created a notification with a NULL tenant and no recipient.
 * A role broadcast with a NULL school_id matches NO reader under the
 * notification policy, so those submissions were written to a place no
 * administrator could ever read them. Both halves were wrong in opposite
 * directions.
 *
 * Option A of the two the review offered is chosen, because it is the one the
 * repository already implements and documents: the page requires a session, and
 * KI-021 records the sessionless path as a DEFECT ("/support additionally
 * requires NO session at all — fix the authorization before adding a limiter"),
 * not as a product requirement. Nothing in the product asks for public support.
 *
 * So: the action requires an authenticated profile with a tenant, derives the
 * tenant server-side, and the resulting notification is readable by that
 * tenant's administrators — which is the whole point of filing one.
 *
 * The caller still controls only a title, a body and an allowlisted category,
 * all bounded before they are stored. Every routing field is a constant.
 *
 * Anti-abuse stays bounded to what can be enforced correctly here. Per-IP
 * throttling is NOT added — university traffic arrives through campus NAT, so an
 * IP is not a caller (the KI-021 reasoning), and an in-memory limiter on
 * serverless is per-instance theatre. Requiring a session is itself the largest
 * abuse control this flow gained.
 */
const SUPPORT_TITLE_MAX = 120;
const SUPPORT_MESSAGE_MAX = 500;
const SUPPORT_MESSAGE_ACCEPT_MAX = 4000;

/**
 * Codex F6. `category` was caller-controlled free text that was interpolated
 * verbatim into the persisted notification body. An anonymous caller could
 * therefore write an arbitrary (and arbitrarily long) string into an
 * admin-facing record. It is now an allowlist: anything not on it is REJECTED,
 * not silently coerced to a default, because quietly accepting an unknown value
 * hides the attempt.
 */
const SUPPORT_CATEGORIES = ["system", "account", "counseling", "roadmap", "course", "other"] as const;
type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];

function isSupportCategory(value: string): value is SupportCategory {
  return (SUPPORT_CATEGORIES as readonly string[]).includes(value);
}

export async function submitSupportInquiry(formData: FormData) {
  const profile = await getDemoProfile();
  // A server action is reachable directly and does not inherit the page's
  // guard, so the requirement is restated here rather than assumed.
  if (!profile || !profile.school_id) {
    return { ok: false, message: "문의를 접수하려면 로그인해 주세요." };
  }
  const title = text(formData.get("title"));
  const message = text(formData.get("message"));
  const category = text(formData.get("category"), "system");

  if (!isSupportCategory(category)) {
    return { ok: false, message: "문의 유형을 다시 선택해 주세요." };
  }

  if (!title || message.length < 8) {
    return { ok: false, message: "문의 제목과 내용을 조금 더 구체적으로 적어 주세요." };
  }

  // Rejected, not truncated: a title silently cut to fit hides what was sent.
  if (title.length > SUPPORT_TITLE_MAX) {
    return { ok: false, message: `문의 제목은 ${SUPPORT_TITLE_MAX}자 이내로 작성해 주세요.` };
  }

  if (message.length > SUPPORT_MESSAGE_ACCEPT_MAX) {
    return { ok: false, message: `문의 내용은 ${SUPPORT_MESSAGE_ACCEPT_MAX}자 이내로 작성해 주세요.` };
  }

  const autoReply = getAutoReply(`${title} ${message}`);
  if (autoReply) {
    return { ok: true, autoReplied: true, message: autoReply };
  }

  // Every routing field below is a constant, and the tenant comes from the
  // session — never from the form. The submission is addressed to the admin
  // ROLE, never to a recipient the caller names.
  const submitter = profile.name;
  const notificationResult = await createUserNotification({
    recipientRole: "admin",
    recipientId: null,
    category: "system",
    title: `운영 문의: ${title}`,
    body: `[${category}] ${submitter}: ${message.slice(0, SUPPORT_MESSAGE_MAX)}`,
    targetHref: "/admin",
    // Derived from the session. A role broadcast with a NULL tenant is readable
    // by nobody, which is what made the old anonymous path write into a void.
    schoolId: profile.school_id,
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
