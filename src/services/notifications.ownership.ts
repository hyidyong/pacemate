import type { DemoProfile } from "@/services/session.service";

/**
 * The single tenant-aware ownership predicate for user_notifications
 * (Stage 8, review finding 3).
 *
 * Previously two predicates existed: bulk writes got a tenant-scoped one and
 * targeted (by-id) writes kept an untenanted one, so knowing a UUID from
 * another university was enough to mark that row read — and
 * markNotificationReadAndGo additionally followed its target_href. Reads used a
 * third, entirely unscoped shape. One definition now serves every read and
 * every write.
 *
 * ## Semantics
 *
 * A notification row is addressed in exactly one of two ways:
 *
 * - **Self-addressed** (`recipient_id = <profile>`): belongs to that profile by
 *   construction. It cannot name anyone else, so it needs no tenant check and
 *   is matched regardless of `school_id`. This also means a row whose
 *   `school_id` was never stamped still reaches its intended recipient.
 *
 * - **Role-addressed** (`recipient_id IS NULL`, `recipient_role = <role>`):
 *   a shared row for everyone holding that role. It is only in scope when its
 *   `school_id` equals the caller's tenant.
 *
 * ## NULL school_id — explicit decision
 *
 * `user_notifications.school_id` is nullable by design (D-018): several ungated
 * writers can leave it NULL. A role-addressed row with NULL `school_id` is
 * therefore treated as **undirected legacy data, not a platform-global
 * broadcast** — it matches nothing here, for reads or writes alike. Rationale:
 * a row that cannot be proven to belong to the caller's tenant must not be
 * exposed to it, which is the same fail-closed stance as resolveTenantContext
 * (D-021). Verified at implementation time: 0 such rows exist live, and every
 * role-addressed row carries a school_id.
 *
 * Because reads and writes share this predicate, a user is never shown a
 * notification they would then be unable to mark read.
 *
 * Making `school_id` NOT NULL, so "undirected" becomes unrepresentable, belongs
 * to the D-018 / KI-019 follow-up.
 */
export function notificationOwnershipFilter(profile: DemoProfile): string {
  const selfAddressed = `recipient_id.eq.${profile.id}`;

  if (!profile.school_id) {
    // A tenant-less profile can only ever own self-addressed rows; matching role
    // broadcasts here would match them platform-wide.
    return selfAddressed;
  }

  return `${selfAddressed},and(recipient_role.eq.${profile.role},school_id.eq.${profile.school_id})`;
}
