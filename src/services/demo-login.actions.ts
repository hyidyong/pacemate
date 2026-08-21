"use server";

import { findDemoPassword, isDemoLoginEnabled } from "@/config/demo-accounts.server";
import { createDemoSession } from "@/services/demo-auth.service";

/**
 * Stage 9 — the QA one-click login, without shipping the password.
 *
 * The browser sends only an identifier it was already shown. The password is
 * looked up here, on the server, from a module a client bundle cannot import.
 * The whole action is inert unless PACEMATE_ENABLE_DEMO_LOGIN=1, so in an
 * environment that has not opted in this is a no-op regardless of what is
 * POSTed to it — which matters, because a server action is reachable directly
 * and does not inherit the login page's rendering conditions.
 */
export async function signInAsDemoAccount(identifier: string) {
  if (!isDemoLoginEnabled()) {
    return { ok: false as const, message: "데모 로그인이 비활성화되어 있습니다." };
  }

  const password = findDemoPassword(identifier);
  if (!password) {
    return { ok: false as const, message: "데모 계정을 찾을 수 없습니다." };
  }

  const formData = new FormData();
  formData.set("identifier", identifier);
  formData.set("password", password);

  // createDemoSession redirects on both success and failure, so control does
  // not return here.
  await createDemoSession(formData);
  return { ok: true as const };
}
