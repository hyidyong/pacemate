"use server";

import { revalidatePath } from "next/cache";
import { getCounselingSlotId } from "@/lib/counseling-slots";
import { logEvent } from "@/lib/observability/log";
import { getRequestId } from "@/lib/observability/request-context";
import { tryResolveTenantContext } from "@/lib/tenant";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { normalizeUuid } from "@/lib/uuid";
import { getAvailableCounselingSlots } from "@/services/counseling.service";
import { createUserNotification } from "@/services/notifications.create.service";
import { getDemoProfile } from "@/services/session.service";

const SLOT_NOT_AVAILABLE_MESSAGE = "선택한 상담 시간을 예약할 수 없습니다. 다른 시간을 선택해 주세요.";
const ALREADY_RESERVED_MESSAGE = "이미 신청된 상담 시간입니다. 신청 내역에서 확인해 주세요.";

// 23P01 = exclusion constraint (counseling_requests_no_active_overlap),
// 23505 = partial unique index (counseling_requests_confirmed_slot_idx).
// Both mean the DB serialized a race this request lost — a deterministic
// conflict, never a retryable storage failure.
const CONFLICT_ERROR_CODES = new Set(["23P01", "23505"]);

type SessionClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

// Idempotency check for duplicate submissions (double click, network retry,
// retry after a lost response): the caller's own active rows are RLS-visible
// to their session, and matching by normalized slot id reuses the exact
// identity rule the booking itself uses (Stage 2 D-004).
async function findOwnActiveRequestForSlotId(
  supabase: SessionClient,
  studentId: string,
  slotId: string,
) {
  const { data } = await supabase
    .from("counseling_requests")
    .select("id, professor_id, requested_start, requested_end")
    .eq("student_id", studentId)
    .in("status", ["pending", "approved"]);

  return (
    (data ?? []).find(
      (row) =>
        getCounselingSlotId({
          professorId: row.professor_id,
          start: row.requested_start,
          end: row.requested_end,
        }) === slotId,
    ) ?? null
  );
}

function text(value: FormDataEntryValue | null, fallback = "") {
  const current = typeof value === "string" ? value.trim() : "";
  return current || fallback;
}

export async function createCounselingRequest(formData: FormData) {
  const profile = await getDemoProfile();
  const slotId = text(formData.get("slotId"));
  const topic = text(formData.get("topic"), "상담 요청");

  if (!profile || profile.role !== "student") {
    return { ok: false, message: "로그인한 학생만 상담을 신청할 수 있습니다." };
  }

  if (!slotId) {
    return { ok: false, message: SLOT_NOT_AVAILABLE_MESSAGE };
  }

  // Stage 6: the authoritative tenant is the student's own school. The slot
  // set is computed for that tenant only, so a crafted slotId naming a foreign
  // professor is not in `availableSlots` and falls through to the deny path
  // below (server boundary for booking, AUDIT X1). The DB WITH CHECK is the
  // second layer if this is ever bypassed.
  const tenant = tryResolveTenantContext(profile);
  if (!tenant) {
    return { ok: false, message: SLOT_NOT_AVAILABLE_MESSAGE };
  }

  let availableSlots;
  try {
    availableSlots = await getAvailableCounselingSlots(tenant.tenantId);
  } catch (error) {
    // Stage 8 P2. This catch used to be silent, and it returns the
    // business-conflict message — so a Supabase outage during booking was
    // invisible to operators AND told the student "that slot is taken", which
    // is false. The user-facing copy is unchanged (Stage 4 charter); what
    // changes is that the fault is now recorded AS a fault.
    logEvent({
      event: "booking.availability_unavailable",
      outcome: "fault",
      requestId: await getRequestId(),
      route: "/counseling",
      tenantId: tenant.tenantId,
      profileId: profile.id,
      detail: error instanceof Error ? error.name : "UnknownError",
    });
    return { ok: false, message: SLOT_NOT_AVAILABLE_MESSAGE };
  }

  const supabase = await createSupabaseServerClient();

  const selectedSlot = availableSlots.find((slot) => getCounselingSlotId(slot) === slotId);
  if (!selectedSlot) {
    // The slot is not bookable NOW. If that is because the caller's own
    // earlier submission already consumed it, the intent succeeded —
    // acknowledge the duplicate instead of telling them to pick another time.
    const ownRequest = await findOwnActiveRequestForSlotId(supabase, profile.id, slotId);
    if (ownRequest) {
      return { ok: true, message: ALREADY_RESERVED_MESSAGE };
    }
    // A submitted slot that no longer exists means the client's list is
    // stale — refresh both consumers so the ghost slot disappears.
    revalidatePath("/counseling");
    revalidatePath("/professor");
    return { ok: false, message: SLOT_NOT_AVAILABLE_MESSAGE };
  }

  // Codex round 5, F1. This INSERT used to run through the SESSION client, so
  // `authenticated` needed table INSERT on counseling_requests — and with that
  // grant a student could skip this function entirely and POST straight to
  // PostgREST. The INSERT policy could only check two things (the student is
  // the caller, the professor is in the same tenant); everything Stage 5
  // actually enforces lives above: the slot must be one of
  // getAvailableCounselingSlots(tenant), which is what makes it canonical,
  // inside the professor's availability, of the professor's slot length, and
  // within the booking horizon — and `status` is a server constant.
  //
  // Measured live before the fix: five direct-INSERT bypasses, all persisted.
  // A non-slot time, an eight-hour duration, 03:00 outside availability, a
  // booking 900 days out, and status='approved' created by the student.
  //
  // Those invariants are not expressible as an RLS predicate without
  // reimplementing the slot engine in SQL and keeping two copies in step. So
  // the boundary moves instead of being duplicated: `authenticated` no longer
  // holds INSERT (20260814200000), and the write happens here, under the
  // service role, AFTER the validation above. Reads keep the session client so
  // RLS still bounds what this student can see.
  //
  // The EXCLUDE constraint still arbitrates concurrency — the service role does
  // not bypass constraints — so the conflict handling below is unchanged.
  const writer = createSupabaseAdminClient();
  const { data, error } = await writer
    .from("counseling_requests")
    .insert({
      student_id: profile.id,
      professor_id: selectedSlot.professorId,
      requested_start: selectedSlot.start,
      requested_end: selectedSlot.end,
      topic,
      status: "pending",
    })
    .select("id")
    .single();

  if (error && CONFLICT_ERROR_CODES.has(error.code)) {
    // A conflict is the constraint doing its job under contention, not a fault.
    // Logged at warn with outcome=conflict so the booking conflict RATE is
    // measurable without conflicts polluting the fault rate that should page.
    logEvent({
      event: "booking.slot_conflict",
      outcome: "conflict",
      requestId: await getRequestId(),
      route: "/counseling",
      tenantId: tenant.tenantId,
      profileId: profile.id,
      code: error.code,
    });
    // Someone consumed the slot between revalidation and the INSERT. The data
    // changed underneath this client, so refresh both consumers either way.
    // If the winner is the caller's own in-flight duplicate, acknowledge it.
    const ownRequest = await findOwnActiveRequestForSlotId(supabase, profile.id, slotId);
    revalidatePath("/counseling");
    revalidatePath("/professor");
    if (ownRequest) {
      return { ok: true, message: ALREADY_RESERVED_MESSAGE };
    }
    return { ok: false, message: SLOT_NOT_AVAILABLE_MESSAGE };
  }

  if (error || !data) {
    // Structured now, and deliberately WITHOUT error.details/hint: Postgres
    // detail strings can embed row values (an identifier is an email address).
    logEvent({
      event: "booking.storage_failure",
      outcome: "fault",
      requestId: await getRequestId(),
      route: "/counseling",
      tenantId: tenant.tenantId,
      profileId: profile.id,
      code: error?.code ?? "missing_insert_result",
    });
    return { ok: false, message: "상담 신청을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }

  const notificationResult = await createUserNotification({
    recipientRole: "professor",
    recipientId: null,
    schoolId: tenant.tenantId,
    category: "counseling",
    title: "새 상담 신청",
    body: `${profile.name} 학생이 ${topic} 상담을 신청했습니다.`,
    targetHref: `/professor?tab=counseling&sub=pending-counseling&requestId=${encodeURIComponent(data.id)}`,
  });

  revalidatePath("/counseling");
  revalidatePath("/professor");

  if (!notificationResult.ok) {
    return { ok: true, message: "상담 신청은 완료됐지만 알림 전송에 실패했습니다." };
  }

  return { ok: true, message: `상담 신청을 보냈습니다. (${data.id.slice(0, 8)})` };
}

export async function reserveSuggestedCounseling(formData: FormData) {
  const profile = await getDemoProfile();
  const originalRequestId = normalizeUuid(text(formData.get("requestId")));

  if (!profile || profile.role !== "student" || !originalRequestId) {
    return { ok: false, message: "추천 상담 요청을 찾을 수 없습니다." };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("counseling_requests")
    .select("professor_id, topic, suggested_start, suggested_end")
    .eq("id", originalRequestId)
    .eq("student_id", profile.id)
    .maybeSingle();

  if (error || !data?.suggested_start || !data.suggested_end) {
    return { ok: false, message: "예약할 추천 시간이 없습니다." };
  }

  const request = new FormData();
  request.set(
    "slotId",
    getCounselingSlotId({
      professorId: data.professor_id,
      start: data.suggested_start,
      end: data.suggested_end,
    }),
  );
  request.set("topic", `${data.topic} (추천 시간 재신청)`);
  return createCounselingRequest(request);
}

const CANCEL_CONFLICT_MESSAGE = "취소할 수 없는 상담 신청입니다. 최신 상태를 확인해 주세요.";

export async function cancelMyCounselingRequest(formData: FormData) {
  const profile = await getDemoProfile();
  const requestId = normalizeUuid(text(formData.get("requestId")));

  if (!profile || profile.role !== "student" || !requestId) {
    return { ok: false, message: CANCEL_CONFLICT_MESSAGE };
  }

  // Admin client + app-level ownership predicate: students have no UPDATE
  // policy on counseling_requests (the whole authenticated policy family is
  // Stage 9's charter), so this mirrors the professor transition path. The
  // single conditional UPDATE is a compare-and-set: only the caller's own
  // still-active (pending/approved) request can move to cancelled, and a
  // competing transition makes this a zero-row conflict instead of a blind
  // overwrite.
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("counseling_requests")
    .update({ status: "cancelled" })
    .eq("id", requestId)
    .eq("student_id", profile.id)
    .in("status", ["pending", "approved"])
    .select("id, topic")
    .single();

  if (error || !data) {
    if (!error || error.code === "PGRST116") {
      return { ok: false, message: CANCEL_CONFLICT_MESSAGE };
    }
    return { ok: false, message: "상담 신청을 취소하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }

  const notificationResult = await createUserNotification({
    recipientRole: "professor",
    recipientId: null,
    schoolId: profile.school_id,
    category: "counseling",
    title: "상담 신청이 취소됐습니다",
    body: `${profile.name} 학생이 ${data.topic} 상담 신청을 취소했습니다.`,
    targetHref: "/professor?tab=counseling",
  });

  revalidatePath("/counseling");
  revalidatePath("/professor");

  if (!notificationResult.ok) {
    return { ok: true, message: "상담 신청은 취소됐지만 알림 전송에 실패했습니다." };
  }

  return { ok: true, message: "상담 신청을 취소했습니다." };
}
