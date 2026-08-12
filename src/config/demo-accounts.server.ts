import "server-only";

import demoUsers from "@/config/demo-users.json";

/**
 * Stage 9 — the demo roster, server side only.
 *
 * `demo-users.json` holds four plaintext passwords, including
 * `admin1@pacemate.edu`. It was imported directly by
 * `components/login/demo-login-button.tsx`, which is a `"use client"` module, so
 * a JSON import there is bundled whole. The credentials were verifiably present
 * in the built artefact (`.next/static/chunks/app/login/page-*.js`), reachable
 * by anyone with `curl` and no authentication — a privileged demo account
 * published on the public login page.
 *
 * `import "server-only"` makes it a build error for any client module to reach
 * this file, so the exposure cannot silently return.
 *
 * The passwords themselves are unchanged here on purpose: they belong to real
 * Supabase Auth users created by `scripts/ensure-demo-operator-auth.mjs`, and
 * rotating a live credential is an operator action, not a code change. That
 * rotation is required and is written up in
 * docs/upgrade/stage-09/RECOVERY_RUNBOOK.md §3.
 */

export type DemoAccountSummary = {
  identifier: string;
  name: string;
  role: string;
};

/** True only when an operator has deliberately switched the shortcut on. */
export function isDemoLoginEnabled(): boolean {
  return process.env.PACEMATE_ENABLE_DEMO_LOGIN === "1";
}

/**
 * What the browser is allowed to know: who the accounts are, never how to
 * authenticate as them.
 */
export function listDemoAccounts(): DemoAccountSummary[] {
  if (!isDemoLoginEnabled()) {
    return [];
  }
  return demoUsers.map((user) => ({
    identifier: user.identifier,
    name: user.name,
    role: user.role,
  }));
}

/** Server-side only: resolve the password for a roster identifier. */
export function findDemoPassword(identifier: string): string | null {
  if (!isDemoLoginEnabled()) {
    return null;
  }
  const match = demoUsers.find((user) => user.identifier === identifier);
  return match?.password ?? null;
}
