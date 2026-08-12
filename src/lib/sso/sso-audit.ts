// Stage 7 (SSO readiness) — identity audit event emitter.
//
// A structured, field-ALLOWLISTED emitter for identity events. No durable
// audit table exists yet (Stage 8/9 outbox family owns that); this module is
// the seam — every identity event goes through ONE function whose output
// shape is frozen by tests, so a later durable sink swaps in here.
//
// Never logged: tokens, authorization codes, raw claims, emails, names, or
// any free-form payload. Subjects appear only as a truncated keyed hash.

import { createHash } from "node:crypto";
import { logEvent } from "@/lib/observability/log";

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
  logEvent({
    event: `sso.${record.event ?? "unknown"}`,
    outcome: record.event === "sso_login_denied" ? "denied" : "ok",
    requestId: record.requestId,
    profileId: record.profileId,
    tenantId: record.schoolId,
    detail: [record.reason, record.providerSlug, record.subjectHash]
      .filter(Boolean)
      .join(" "),
  });
}
