// Stage 6 (multi-tenancy) authoritative tenant resolution.
//
// tenant_id === schools.id. The ONLY authoritative tenant for a request is the
// school of the server-verified profile — never a value taken from the client
// (?tenant_id, a request body, a hidden field, localStorage). Callers pass the
// profile they already resolved from the session/DB; this helper turns it into
// a tenant context or fails closed.
//
// This is the single chokepoint the future Stage 7 membership model swaps in:
// today "one profile -> one tenant" reads profile.school_id; a later
// membership join would resolve the active membership here without touching any
// call site. It is a pure function (no imports, no side effects) so it is
// importable and testable everywhere; the "authoritative" property comes from
// callers only ever passing a server-verified profile.

export class TenantResolutionError extends Error {
  constructor(message = "No authoritative tenant for the current profile") {
    super(message);
    this.name = "TenantResolutionError";
  }
}

export type TenantContext = {
  tenantId: string;
};

// A structural subset of DemoProfile — kept local so this module has zero
// imports and can be loaded directly (like the counseling-slots domain).
type TenantResolvable = {
  school_id: string | null;
} | null;

export function resolveTenantContext(profile: TenantResolvable): TenantContext {
  const tenantId = profile?.school_id;
  if (!tenantId) {
    throw new TenantResolutionError();
  }
  return { tenantId };
}

// Non-throwing variant for read paths that must degrade to an empty view
// rather than error (e.g. a page rendered for a session missing its tenant).
export function tryResolveTenantContext(profile: TenantResolvable): TenantContext | null {
  try {
    return resolveTenantContext(profile);
  } catch {
    return null;
  }
}
