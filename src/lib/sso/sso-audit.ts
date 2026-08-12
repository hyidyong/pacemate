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
] as const;

export function emitSsoAuditEvent(event: SsoAuditEvent): void {
  const record: Record<string, string> = {};
  for (const field of ALLOWED_FIELDS) {
    const value = event[field];
    if (typeof value === "string" && value) {
      record[field] = value;
    }
  }
  console.info("[sso-audit]", JSON.stringify(record));
}
