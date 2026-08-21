import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logEvent, type LogOutcome } from "@/lib/observability/log";

/**
 * Stage 9 — the durable half of the audit story.
 *
 * Stage 8 established structured operational logging (D-023). That is a
 * different requirement from an audit trail: operational logs answer "is the
 * system healthy right now", and they live in the platform's retention window.
 * An audit trail answers "who changed this identity, privilege or tenant
 * setting, and when" — a question that is asked months later, usually about a
 * dispute or an incident.
 *
 * Before this module every security-sensitive event in the application ended at
 * stdout, and several ended nowhere at all (tenant-wide admin broadcasts,
 * counseling status transitions, hard deletes).
 *
 * SCOPE. This is deliberately NOT a request log. Only events that change
 * identity, privilege, tenant configuration, or correctness-critical state are
 * recorded, so the table grows with administrative activity rather than with
 * traffic.
 *
 * FAILURE MODE. Auditing must never break the action being audited: a failed
 * insert degrades to an operational log line and the caller proceeds. That is a
 * deliberate availability-over-completeness choice, and it means the trail is
 * best-effort, not guaranteed — stated plainly rather than implied otherwise.
 *
 * NOT CLAIMED. There is no hash chain and no signature; this is not
 * tamper-proof. What it is: unwritable and undeletable by every role the
 * browser can reach (20260814030000 grants no client role INSERT/UPDATE/DELETE
 * and defines no non-SELECT policy).
 */

export type SecurityAuditEvent = {
  /** Dotted, stable name, e.g. "sso.jit_provisioned", "admin.broadcast_sent". */
  event: string;
  outcome: LogOutcome;
  actorProfileId?: string | null;
  actorRole?: string | null;
  schoolId?: string | null;
  /** What was acted on, as a type + opaque id. Never a name or an email. */
  subjectType?: string | null;
  subjectId?: string | null;
  requestId?: string | null;
  /** Short allowlisted classification. Never a raw error or user content. */
  detail?: string | null;
};

const MAX_DETAIL = 200;

/** Mirrors the DB CHECK so an over-long detail degrades instead of failing. */
function boundDetail(detail: string | null | undefined): string | null {
  if (!detail) return null;
  return detail.length > MAX_DETAIL ? detail.slice(0, MAX_DETAIL) : detail;
}

export function buildSecurityEventRow(event: SecurityAuditEvent) {
  return {
    event: event.event,
    outcome: event.outcome,
    actor_profile_id: event.actorProfileId ?? null,
    actor_role: event.actorRole ?? null,
    school_id: event.schoolId ?? null,
    subject_type: event.subjectType ?? null,
    subject_id: event.subjectId ?? null,
    request_id: event.requestId ?? null,
    detail: boundDetail(event.detail),
  };
}

export async function recordSecurityEvent(event: SecurityAuditEvent): Promise<void> {
  // The operational line is emitted first and unconditionally, so an event is
  // never lost entirely just because the durable write fails.
  logEvent({
    event: event.event,
    outcome: event.outcome,
    requestId: event.requestId ?? undefined,
    tenantId: event.schoolId ?? undefined,
    profileId: event.actorProfileId ?? undefined,
    detail: event.detail ?? undefined,
  });

  try {
    const { error } = await createSupabaseAdminClient()
      .from("security_events")
      .insert(buildSecurityEventRow(event));

    if (error) {
      logEvent({
        event: "audit.write_failed",
        outcome: "fault",
        code: error.code,
        requestId: event.requestId ?? undefined,
        detail: event.event,
      });
    }
  } catch {
    logEvent({
      event: "audit.write_failed",
      outcome: "fault",
      requestId: event.requestId ?? undefined,
      detail: event.event,
    });
  }
}
