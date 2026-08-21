import type { DemoProfile } from "@/services/session.service";

/**
 * The single ownership predicate for user_notifications, shared by every read
 * and every write (Stage 8, review finding 3).
 *
 * ## Codex round 4, finding 1 — this predicate used to have a second branch
 *
 * It previously read:
 *
 * ```
 * recipient_id.eq.<me>,and(recipient_role.eq.<my role>,school_id.eq.<my tenant>)
 * ```
 *
 * The second branch matched ROLE-ADDRESSED rows: a single row with
 * `recipient_id = NULL` that every holder of that role in that tenant shared.
 * Because `is_read` is a column on the row, the branch also made a peer's read
 * state writable — one student opening a tenant announcement marked it read for
 * the entire cohort. Measured live: 14 shared rows, 12 already flipped to read.
 *
 * Broadcasts are now fanned out into one row per recipient at creation time
 * (`notifications.create.service.ts`), `recipient_id` is NOT NULL
 * (`20260814150000`), and the RLS policies match on identity alone. So the role
 * branch has no rows left to match and is deleted rather than narrowed — the
 * predicate is now exactly "rows addressed to me".
 *
 * This is strictly narrower than what it replaces. Nothing a user could
 * legitimately see or mark before is lost: the broadcast they used to share is
 * now their own copy of it.
 *
 * ## Why the tenant term is gone too
 *
 * It is subsumed. A notification is addressed to exactly one profile, and a
 * profile belongs to exactly one tenant, so matching the recipient already
 * settles tenancy. The tenant term existed only to bound the role branch.
 *
 * Because reads and writes share this predicate, a user is never shown a
 * notification they would then be unable to mark read.
 */
export function notificationOwnershipFilter(profile: DemoProfile): string {
  return `recipient_id.eq.${profile.id}`;
}
