// Stage 7 (SSO readiness) — identity audit event emitter.
//
// A structured, field-ALLOWLISTED emitter for identity events. It was built as
// the seam for a durable sink, and Stage 9 filled it in: every identity event
// still goes through ONE function whose output shape is frozen by tests, and
// that function now also appends to public.security_events (20260814030000).
//
// Never logged: tokens, authorization codes, raw claims, emails, names, or
// any free-form payload. Subjects appear only as a truncated keyed hash.

import { createHash } from "node:crypto";
import { recordSecurityEvent } from "@/lib/observability/security-audit";

export type SsoAuditEventName =
  | "sso_login_ok"
  | "sso_login_denied"
  | "sso_account_linked"
  | "sso_jit_provisioned"
  | "sso_role_drift";

export type SsoAuditEvent = {
  event: SsoAuditEventName;
  reason?: string;
  profileId?: string;
  schoolId?: string;
  providerSlug?: string;
  subjectHash?: string;
  requestId?: string;
};

// Stable pseudonymous handle for an external subject: correlates one
// subject's events without storing the raw identifier.
export function hashSsoSubject(providerRef: string, subject: string): string {
  return createHash("sha256")
    .update(`${providerRef}:${subject}`)
    .digest("hex")
    .slice(0, 16);
}

const ALLOWED_FIELDS = [
  "event",
  "reason",
  "profileId",
  "schoolId",
  "providerSlug",
  "subjectHash",
  // Server-minted correlation id (never a client value — see
  // lib/observability/request-id.ts). Lets an identity event be joined to the
  // request that produced it.
  "requestId",
] as const;

export function emitSsoAuditEvent(event: SsoAuditEvent): void {
  const record: Record<string, string> = {};
  for (const field of ALLOWED_FIELDS) {
    const value = event[field];
    if (typeof value === "string" && value) {
      record[field] = value;
    }
  }

  // Stage 8 P2: emitted through the shared structured logger so identity events
  // carry the same envelope (and, later, the same durable sink) as everything
  // else. The allowlist above still runs first and is unchanged — it is
  // narrower than the logger's, and the pseudonymous subjectHash rides in
  // `detail` rather than widening the shared field set.
  const outcome = record.event === "sso_login_denied" ? "denied" : "ok";
  const detail = [record.reason, record.providerSlug, record.subjectHash]
    .filter(Boolean)
    .join(" ");

  // Stage 9: the "later durable sink" this comment anticipated. Identity
  // creation and binding are the events most worth keeping past a log window,
  // so these go to the append-only table as well as to stdout. The write is
  // fire-and-forget: an audit failure must not break a login, and
  // recordSecurityEvent already emits the operational line itself.
  void recordSecurityEvent({
    event: `sso.${record.event ?? "unknown"}`,
    outcome,
    actorProfileId: record.profileId ?? null,
    schoolId: record.schoolId ?? null,
    subjectType: record.subjectHash ? "sso_subject" : null,
    subjectId: record.subjectHash ?? null,
    requestId: record.requestId ?? null,
    detail: detail || null,
  });
}
