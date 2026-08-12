"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import {
  createUserNotification,
  type UserNotificationCreateInput,
} from "@/services/notifications.create.service";
import { getDemoProfile } from "@/services/session.service";

function text(value: FormDataEntryValue | null, fallback = "") {
  const current = typeof value === "string" ? value.trim() : "";
  return current || fallback;
}

export async function updateRoadmapRevisionStatus(formData: FormData) {
  const profile = await getDemoProfile();
  const requestId = text(formData.get("requestId"));
  const status = text(formData.get("status"));
  const adminNote = text(formData.get("adminNote"));

  // Every outcome redirects with a result code the board renders — the old
  // void returns meant approvals and failures were both silent (Stage 4,
  // audit B-42/B-43).
  if (!requestId || !["assistant_reviewed", "approved", "rejected"].includes(status)) {
    redirect("/admin?result=invalid");
  }

  // 반려 fans out a student-facing notification; requiring a reason both
  // informs the student and prevents an accidental one-click rejection.
  if (status === "rejected" && !adminNote) {
    redirect(`/admin?result=note_required&request=${requestId}`);
  }

  const timestamp = new Date().toISOString();
  const patch =
    status === "assistant_reviewed"
      ? {
          status,
          reviewed_by: profile?.id ?? null,
          reviewed_by_name: profile?.name ?? "조교",
          reviewed_at: timestamp,
          admin_note: adminNote || null,
        }
      : status === "approved"
        ? {
            status,
            approved_by: profile?.id ?? null,
            approved_by_name: profile?.name ?? "관리자",
            approved_at: timestamp,
            rejected_at: null,
            admin_note: adminNote || null,
          }
        : {
            status,
            rejected_at: timestamp,
            admin_note: adminNote || null,
          };

  const { data, error } = await supabase
    .from("roadmap_revision_requests")
    .update(patch)
    .eq("id", requestId)
    .select("id, title, course_id, course_code")
    .single();

  if (error) {
    redirect("/admin?result=error");
  }

  const notification: UserNotificationCreateInput =
    status === "assistant_reviewed"
      ? {
          recipientRole: "admin",
          recipientId: null,
          category: "revision",
          title: "조교 검토 완료",
          body: `${data.title} 요청이 최종 승인을 기다립니다.`,
          targetHref: `/admin?request=${data.id}`,
        }
      : {
          recipientRole: "student",
          recipientId: null,
          category: "revision",
          title: status === "approved" ? "로드맵 수정 반영" : "로드맵 수정 반려",
          body:
            status === "approved"
              ? `${data.title} 승인본이 학생 로드맵에 반영됐습니다.`
              : `${data.title} 요청이 반려됐습니다.`,
          targetHref: data.course_id ? `/roadmap/${data.course_id}` : "/roadmap",
        };

  await createUserNotification(notification);

  revalidatePath("/admin");
  revalidatePath("/professor");
  revalidatePath("/roadmap");
  if (data.course_id) {
    revalidatePath(`/roadmap/${data.course_id}`);
  }

  redirect(`/admin?result=${status}&request=${data.id}`);
}
