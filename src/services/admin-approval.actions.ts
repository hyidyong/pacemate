"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  createUserNotification,
  type UserNotificationCreateInput,
} from "@/services/notifications.create.service";
import { recordSecurityEvent } from "@/lib/observability/security-audit";
import { getDemoProfile } from "@/services/session.service";

function text(value: FormDataEntryValue | null, fallback = "") {
  const current = typeof value === "string" ? value.trim() : "";
  return current || fallback;
}

/**
 * Codex round 3, F5 — legal transitions for a roadmap revision.
 *
 * The update was previously `.eq("id").eq("school_id")` with no expected prior
 * state, so `approved` could be walked back to `assistant_reviewed`, a rejected
 * request could be revived, and two admins deciding at once BOTH succeeded —
 * last write wins, and both fanned out a student-facing notification.
 *
 * Derived from the workflow the board actually drives: an assistant reviews a
 * pending request; an admin decides on something pending or already reviewed;
 * approved and rejected are terminal.
 */
const LEGAL_TRANSITION_SOURCES: Record<string, readonly string[]> = {
  assistant_reviewed: ["pending"],
  approved: ["pending", "assistant_reviewed"],
  rejected: ["pending", "assistant_reviewed"],
};

export function legalSourcesFor(status: string): readonly string[] | null {
  return LEGAL_TRANSITION_SOURCES[status] ?? null;
}

export async function updateRoadmapRevisionStatus(formData: FormData) {
  const profile = await getDemoProfile();
  const requestId = text(formData.get("requestId"));
  const status = text(formData.get("status"));
  const adminNote = text(formData.get("adminNote"));

  // Stage 9. `profile` was previously read only to fill in `reviewed_by_name` /
  // `approved_by_name` — it was never checked. /admin's page-level
  // requireRoles() does not run on a server action POST, so an unauthenticated
  // caller could approve any curriculum revision, which publishes its patch
  // into every student's roadmap. Approving and rejecting are admin decisions;
  // the intermediate review step is the assistant's.
  if (!profile) {
    redirect("/admin?result=invalid");
  }
  const isAdmin = profile.role === "admin";
  const isAssistant = profile.role === "assistant";
  if (!isAdmin && !isAssistant) {
    redirect("/admin?result=invalid");
  }
  if (status !== "assistant_reviewed" && !isAdmin) {
    redirect("/admin?result=invalid");
  }

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
          reviewed_by: profile.id,
          reviewed_by_name: profile.name,
          reviewed_at: timestamp,
          admin_note: adminNote || null,
        }
      : status === "approved"
        ? {
            status,
            approved_by: profile.id,
            approved_by_name: profile.name,
            approved_at: timestamp,
            rejected_at: null,
            admin_note: adminNote || null,
          }
        : {
            status,
            rejected_at: timestamp,
            admin_note: adminNote || null,
          };

  // Codex F4: role alone is not authorization. Approving merges the request's
  // patch into the roadmap every student reads, so a tenant B admin holding a
  // tenant A request's UUID could publish into A. The predicate is constrained
  // by school_id as well as id, so the service-role update cannot reach outside
  // the caller's own university even if the id is guessed or leaked.
  // Codex round 3, F5: a compare-and-set on the expected prior state, so a
  // terminal decision cannot be walked back and two concurrent deciders resolve
  // to exactly one winner. Zero matched rows is STALE, not success.
  const legalSources = legalSourcesFor(status);
  if (!legalSources) {
    redirect("/admin?result=invalid");
  }

  const { data: updated, error } = await createSupabaseAdminClient()
    .from("roadmap_revision_requests")
    .update(patch)
    .eq("id", requestId)
    .eq("school_id", profile.school_id)
    .in("status", legalSources as string[])
    .select("id, title, course_id, course_code");

  if (error) {
    redirect("/admin?result=error");
  }

  // Exactly one row, or somebody else decided first / the request is already
  // terminal. The notification below must fire only for the actual winner.
  if (!updated || updated.length !== 1) {
    redirect(`/admin?result=stale&request=${requestId}`);
  }
  const data = updated[0];

  const notification: UserNotificationCreateInput =
    status === "assistant_reviewed"
      ? {
          recipientRole: "admin",
          recipientId: null,
          category: "revision",
          title: "조교 검토 완료",
          body: `${data.title} 요청이 최종 승인을 기다립니다.`,
          targetHref: `/admin?request=${data.id}`,
          // Stage 9: role broadcasts are only readable by the same tenant, so
          // an unstamped school_id makes the notification invisible (D-018).
          schoolId: profile.school_id,
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
          schoolId: profile.school_id,
        };

  await createUserNotification(notification);

  // A curriculum revision moving to `approved` publishes its patch into every
  // student's roadmap. Stage 9 records the transition durably: before this,
  // approving left no trace anywhere once the log window closed.
  await recordSecurityEvent({
    event: `admin.revision_${status}`,
    outcome: "ok",
    actorProfileId: profile.id,
    actorRole: profile.role,
    schoolId: profile.school_id,
    subjectType: "roadmap_revision_request",
    subjectId: data.id,
    detail: status,
  });

  revalidatePath("/admin");
  revalidatePath("/professor");
  revalidatePath("/roadmap");
  if (data.course_id) {
    revalidatePath(`/roadmap/${data.course_id}`);
  }

  redirect(`/admin?result=${status}&request=${data.id}`);
}
