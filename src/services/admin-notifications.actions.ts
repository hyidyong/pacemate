"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getDemoProfile } from "@/services/session.service";

type BroadcastResult = { ok: boolean; message: string };
const initialError: BroadcastResult = { ok: false, message: "입력 내용을 확인해 주세요." };

function asTargetGroup(value: FormDataEntryValue | null) {
  const group = typeof value === "string" ? value : "";
  return group === "ALL" || group === "STUDENT" || group === "PROFESSOR" ? group : null;
}

export async function sendAdminBroadcastNotification(
  _previous: BroadcastResult,
  formData: FormData,
): Promise<BroadcastResult> {
  const profile = await getDemoProfile();
  if (!profile || profile.role !== "admin") {
    return { ok: false, message: "관리자만 알림을 발송할 수 있습니다." };
  }

  const targetGroup = asTargetGroup(formData.get("targetGroup"));
  const titleValue = formData.get("title");
  const contentValue = formData.get("content");
  const title = typeof titleValue === "string" ? titleValue.trim() : "";
  const body = typeof contentValue === "string" ? contentValue.trim() : "";
  if (!targetGroup || !title || !body || title.length > 120 || body.length > 1000) {
    return initialError;
  }

  let admin;
  try {
    admin = createSupabaseAdminClient();
  } catch {
    return { ok: false, message: "알림 데이터베이스 설정을 확인해 주세요." };
  }

  let recipients = admin.from("profiles").select("id, role").in("role", ["student", "professor"]);
  if (targetGroup === "STUDENT") recipients = recipients.eq("role", "student");
  if (targetGroup === "PROFESSOR") recipients = recipients.eq("role", "professor");

  const { data, error } = await recipients;
  if (error || !data?.length) {
    return { ok: false, message: "수신자를 찾지 못했습니다." };
  }

  const { error: insertError } = await admin.from("user_notifications").insert(
    data.map((recipient) => ({
      recipient_id: recipient.id,
      recipient_role: recipient.role,
      target_group: targetGroup,
      category: "system",
      title,
      body,
      target_href: "/notifications",
      is_read: false,
    })),
  );
  if (insertError) {
    console.error("Admin notification broadcast failed", insertError.message);
    return { ok: false, message: "알림을 발송하지 못했습니다. 다시 시도해 주세요." };
  }

  revalidatePath("/admin");
  revalidatePath("/notifications");
  revalidatePath("/dashboard");
  revalidatePath("/professor");
  return { ok: true, message: `${data.length}명에게 알림을 발송했습니다.` };
}
