/**
 * Supabase projects known to contain production data.
 *
 * This list is compiled into repository code on purpose. Environment variables
 * are inputs to the guards and therefore cannot be trusted to decide that a
 * production project is safe. Add every future production project ref here.
 */
export const KNOWN_PRODUCTION_PROJECT_REFS = new Set([
  "szztsqdnvenfbgxtylkl",
]);

export function isKnownProductionProjectRef(projectRef) {
  return typeof projectRef === "string" && KNOWN_PRODUCTION_PROJECT_REFS.has(projectRef);
}
