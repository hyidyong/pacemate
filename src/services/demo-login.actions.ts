"use server";

import { findDemoCredentialForRole, isDemoLoginEnabled } from "@/config/demo-accounts.server";
import { isDemoLoginRole } from "@/config/demo-login-policy";
import { createDemoSession } from "@/services/demo-auth.service";

/**
 * Stage 9 — the QA one-click login, without shipping the password.
 * Post-Stage-10 UX restoration — keyed by ROLE instead of identifier.
 *
 * The browser sends only a role name. The identifier and password are looked
 * up here, on the server, from a module a client bundle cannot import. The
 * whole action is inert unless PACEMATE_ENABLE_DEMO_LOGIN=1 and a runtime
 * credential exists, so in an environment that has not opted in this is a
 * no-op regardless of what is POSTed to it — which matters, because a server
 * action is reachable directly and does not inherit the login page's rendering
 * conditions. The sign-in itself goes through the same `createDemoSession`
 * path as the password form, so authorization, profile/role checks, onboarding
 * redirects and session cookies are unchanged.
 */
export async function signInAsDemoRole(role: unknown) {
  if (!isDemoLoginEnabled()) {
    return { ok: false as const, message: "데모 로그인이 비활성화되어 있습니다." };
  }

  if (!isDemoLoginRole(role)) {
    return { ok: false as const, message: "지원하지 않는 데모 역할입니다." };
  }

  const credential = findDemoCredentialForRole(role);
  if (!credential) {
    return { ok: false as const, message: "이 역할의 데모 계정이 설정되어 있지 않습니다." };
  }

  const formData = new FormData();
  formData.set("identifier", credential.identifier);
  formData.set("password", credential.password);

  // createDemoSession redirects on both success and failure, so control does
  // not return here.
  await createDemoSession(formData);
  return { ok: true as const };
}
