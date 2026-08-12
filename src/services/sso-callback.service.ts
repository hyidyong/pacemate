import "server-only";

import type { User } from "@supabase/supabase-js";
import { createDemoSession as issueAppSessionCookie, destroyDemoSession } from "@/lib/auth/demo-session";
import {
  findSsoProviderByRef,
  parseSsoProviderRegistry,
  type SsoProviderRegistry,
} from "@/lib/sso/provider-registry";
import { emitSsoAuditEvent, hashSsoSubject } from "@/lib/sso/sso-audit";
import {
  evaluateAccountLink,
  evaluateSsoLogin,
  type SsoDenyReason,
  type SsoIdentitySnapshot,
  type SsoProfileRow,
} from "@/lib/sso/sso-login-policy";
import { resolveTenantContext } from "@/lib/tenant";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getRoleHomePath } from "@/services/session.service";

// Stage 7 (SSO readiness) — the server-side SSO callback boundary.
//
// The protocol exchange (state/PKCE/nonce/JWKS/issuer/audience verification)
// is performed by the auth platform (GoTrue) before this code ever runs; this
// boundary owns everything the platform cannot know: tenant↔provider binding,
// membership resolution, account linking, JIT policy, suspension, and app
// session issuance. Tenant NEVER comes from the request (query/body/cookie) —
// it derives exclusively from the registry entry matched by the VERIFIED
// identity's provider. Frozen by sso-wiring.test.mjs.

const PROFILE_COLUMNS = "id, identifier, role, school_id, auth_user_id";

export type SsoCallbackResult = {
  ok: boolean;
  redirectTo: string;
};

// The registry is env-supplied public metadata (PACEMATE_SSO_PROVIDERS).
// A malformed registry fails closed to EMPTY (every SSO login denies) rather
// than half-trusting a broken identity config.
export function loadSsoProviderRegistry(): SsoProviderRegistry {
  try {
    return parseSsoProviderRegistry(process.env.PACEMATE_SSO_PROVIDERS);
  } catch (error) {
    console.warn(
      "[sso] provider registry rejected — SSO disabled:",
      error instanceof Error ? error.message : "unparseable registry",
    );
    return [];
  }
}

// Extracts the verified external identity from the GoTrue user. Returns null
// when the user has no external identity (e.g. a password-only account
// hitting the callback) — that is a controlled deny, not an error.
export function buildSsoIdentitySnapshot(user: User | null | undefined): SsoIdentitySnapshot | null {
  const identities = Array.isArray(user?.identities) ? user.identities : [];
  const external = identities.find(
    (identity) =>
      typeof identity?.provider === "string" &&
      identity.provider !== "email" &&
      identity.provider !== "phone",
  );
  if (!external) return null;

  const data: Record<string, unknown> =
    (external.identity_data as Record<string, unknown> | undefined) ?? {};
  const subject =
    typeof data.sub === "string" && data.sub
      ? data.sub
      : typeof external.id === "string" && external.id
        ? external.id
        : null;
  const email =
    typeof data.email === "string" && data.email
      ? data.email
      : typeof user?.email === "string" && user.email
        ? user.email
        : null;
  const displayName =
    typeof data.name === "string" && data.name ? data.name : null;
  const affiliation =
    typeof data.affiliation === "string" && data.affiliation ? data.affiliation : null;

  return {
    providerRef: external.provider,
    subject,
    email,
    emailVerified: data.email_verified === true,
    displayName,
    affiliation,
  };
}

export async function processSsoCallback(code: string): Promise<SsoCallbackResult> {
  let supabase: Awaited<ReturnType<typeof createSupabaseServerClient>> | null = null;

  const denied = async (
    reason: SsoDenyReason,
    context: { providerSlug?: string; subjectHash?: string; schoolId?: string } = {},
  ): Promise<SsoCallbackResult> => {
    // Every deny discards the half-built authentication state: the GoTrue
    // session AND any stale app cookie. No partial sessions survive.
    if (supabase) {
      await supabase.auth.signOut().catch(() => undefined);
    }
    await destroyDemoSession().catch(() => undefined);
    emitSsoAuditEvent({ event: "sso_login_denied", reason, ...context });
    return { ok: false, redirectTo: `/login?error=sso_${reason}` };
  };

  if (typeof code !== "string" || !code.trim()) {
    return denied("failed");
  }

  try {
    supabase = await createSupabaseServerClient();
  } catch {
    return denied("failed");
  }

  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) {
    // Covers invalid/expired/replayed codes and PKCE/state failures — GoTrue
    // rejects the exchange; a duplicate callback cannot mint a second session.
    return denied("failed");
  }

  const { data: userData, error: userError } = await supabase.auth.getUser();
  const user = userData?.user;
  if (userError || !user) {
    return denied("failed");
  }

  const identity = buildSsoIdentitySnapshot(user);
  if (!identity) {
    return denied("failed");
  }

  const registry = loadSsoProviderRegistry();
  const provider = findSsoProviderByRef(registry, identity.providerRef);
  const subjectHash = identity.subject
    ? hashSsoSubject(identity.providerRef, identity.subject)
    : undefined;
  const auditContext = { providerSlug: provider?.slug, subjectHash };

  const admin = createSupabaseAdminClient();

  // Membership resolution by the STABLE identity key only (auth_user_id —
  // provider+issuer+subject is pinned to this auth user by the platform).
  let profile: SsoProfileRow | null = null;
  {
    const { data, error } = await admin
      .from("profiles")
      .select(PROFILE_COLUMNS)
      .eq("auth_user_id", user.id)
      .maybeSingle();
    if (error) {
      return denied("failed", auditContext);
    }
    profile = (data as SsoProfileRow | null) ?? null;
  }

  // First-login account linking against a pre-provisioned profile
  // (SSO_DESIGN §5): institutional email is trusted exactly once, under the
  // four link conditions, then never consulted again.
  let linkedThisLogin = false;
  if (!profile && provider && identity.email) {
    const { data: candidateData, error: candidateError } = await admin
      .from("profiles")
      .select(PROFILE_COLUMNS)
      .ilike("identifier", identity.email)
      .is("auth_user_id", null)
      .maybeSingle();
    if (candidateError) {
      return denied("failed", auditContext);
    }
    const candidate = (candidateData as SsoProfileRow | null) ?? null;
    if (candidate) {
      const link = evaluateAccountLink({ identity, provider, candidate });
      if (!link.ok) {
        return denied(link.reason, auditContext);
      }
      // Compare-and-set: only an still-unlinked row accepts the identity, so
      // a concurrent duplicate callback cannot double-link.
      const { data: updated, error: updateError } = await admin
        .from("profiles")
        .update({ auth_user_id: user.id })
        .eq("id", candidate.id)
        .is("auth_user_id", null)
        .select(PROFILE_COLUMNS)
        .maybeSingle();
      if (updateError || !updated || (updated as SsoProfileRow).auth_user_id !== user.id) {
        return denied("identity_conflict", auditContext);
      }
      profile = updated as SsoProfileRow;
      linkedThisLogin = true;
    }
  }

  let school: { id: string; status: string | null } | null = null;
  if (provider) {
    const { data, error } = await admin
      .from("schools")
      .select("id, status")
      .eq("id", provider.schoolId)
      .maybeSingle();
    if (error) {
      return denied("failed", auditContext);
    }
    school = (data as { id: string; status: string | null } | null) ?? null;
  }

  const decision = evaluateSsoLogin({ identity, provider, profile, school });

  if (decision.kind === "deny") {
    return denied(decision.reason, auditContext);
  }

  let allowedProfileId: string;
  let allowedRole: "student" | "professor" | "assistant" | "admin";

  if (decision.kind === "provision") {
    // JIT (per-tenant opt-in, default OFF; role ceiling "student" enforced in
    // the policy). identifier stays globally unique — a cross-tenant handle
    // collision surfaces as an insert conflict and denies, never merges.
    const { data: created, error: insertError } = await admin
      .from("profiles")
      .insert({
        identifier: identity.email,
        name: identity.displayName ?? identity.email,
        role: decision.role,
        school_id: decision.tenantId,
        auth_user_id: user.id,
      })
      .select(PROFILE_COLUMNS)
      .maybeSingle();
    if (insertError || !created) {
      return denied("identity_conflict", auditContext);
    }
    emitSsoAuditEvent({
      event: "sso_jit_provisioned",
      profileId: (created as SsoProfileRow).id,
      schoolId: decision.tenantId,
      ...auditContext,
    });
    allowedProfileId = (created as SsoProfileRow).id;
    allowedRole = decision.role;
  } else {
    allowedProfileId = decision.profileId;
    allowedRole = decision.role;
  }

  // Stage 6 chokepoint stays authoritative: the session is only minted for a
  // tenant that resolves (and is not suspended) through resolveTenantContext.
  try {
    resolveTenantContext({
      school_id: decision.tenantId,
      school_status: school?.status ?? null,
    });
  } catch {
    return denied("tenant_mismatch", auditContext);
  }

  if (linkedThisLogin) {
    emitSsoAuditEvent({
      event: "sso_account_linked",
      profileId: allowedProfileId,
      schoolId: decision.tenantId,
      ...auditContext,
    });
  }

  // Fresh app session minted ONLY after the full decision (session-fixation
  // discipline): a new HMAC cookie value, never a reused pre-auth one.
  await issueAppSessionCookie({ profileId: allowedProfileId, role: allowedRole });
  emitSsoAuditEvent({
    event: "sso_login_ok",
    profileId: allowedProfileId,
    schoolId: decision.tenantId,
    ...auditContext,
  });

  return { ok: true, redirectTo: getRoleHomePath(allowedRole) };
}
