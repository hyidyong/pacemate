/**
 * Codex round 3, F5 — legal transitions for a roadmap revision request.
 *
 * The update was previously `.eq("id").eq("school_id")` with no expected prior
 * state, so `approved` could be walked back to `assistant_reviewed`, a rejected
 * request could be revived, and two admins deciding at once BOTH succeeded —
 * last write wins, and both fanned out a student-facing notification.
 *
 * Derived from the workflow the board actually drives: an assistant reviews a
 * pending request; an admin decides on something pending or already reviewed;
 * approved and rejected are terminal.
 *
 * This table lives in a plain module rather than in `admin-approval.actions.ts`
 * because that file is `"use server"`, where every export becomes a remotely
 * invocable endpoint and must therefore be an async function. A pure lookup
 * belongs here, where it is directly unit-testable and reachable only in-process.
 */
const LEGAL_TRANSITION_SOURCES: Record<string, readonly string[]> = {
  assistant_reviewed: ["pending"],
  approved: ["pending", "assistant_reviewed"],
  rejected: ["pending", "assistant_reviewed"],
};

/**
 * The states a request may legally be in for `status` to be a valid next state.
 * `null` means the target status is not a transition anyone may perform — an
 * unknown status, or `pending`, which nothing may return to.
 */
export function legalSourcesFor(status: string): readonly string[] | null {
  return LEGAL_TRANSITION_SOURCES[status] ?? null;
}
