"use server";

import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase/client";
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

  if (!requestId || !["assistant_reviewed", "approved", "rejected"].includes(status)) {
    return;
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
    return;
  }

  const notification =
    status === "assistant_reviewed"
      ? {
          recipient_role: "admin",
          category: "revision",
          title: "조교 검토 완료",
          body: `${data.title} 요청이 최종 승인을 기다립니다.`,
          target_href: `/admin?request=${data.id}`,
        }
      : {
          recipient_role: "student",
          category: "revision",
          title: status === "approved" ? "로드맵 수정 반영" : "로드맵 수정 반려",
          body:
            status === "approved"
              ? `${data.title} 승인본이 학생 로드맵에 반영됐습니다.`
              : `${data.title} 요청이 반려됐습니다.`,
          target_href: data.course_id ? `/roadmap/${data.course_id}` : "/roadmap",
        };

  await supabase.from("user_notifications").insert(notification);

  revalidatePath("/admin");
  revalidatePath("/professor");
  revalidatePath("/roadmap");
  if (data.course_id) {
    revalidatePath(`/roadmap/${data.course_id}`);
  }

  return;
}
