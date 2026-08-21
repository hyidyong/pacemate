import "server-only";

import demoUsers from "@/config/demo-users.json";
import {
  listAvailableDemoLoginRoles,
  parseDemoPasswordTable,
  resolveDemoCredentialForRole,
  type DemoCredential,
  type DemoLoginConfig,
  type DemoLoginRole,
  type DemoPasswordTable,
} from "@/config/demo-login-policy";

/**
 * Stage 9 (Codex F5) — the demo roster, with no credential in the repository.
 *
 * HISTORY. `demo-users.json` used to carry four plaintext passwords, including
 * `prof1@` (professor) and `admin1@` (admin). It was imported by a `"use client"`
 * module, so those credentials were compiled into the public login page's
 * JavaScript and were readable with `curl` and no authentication for the
 * lifetime of every deployment built from that code.
 *
 * Removing them from the current bundle does not invalidate a password that was
 * already published, so all four were ROTATED against Supabase Auth on
 * 2026-08-14: each new credential was verified to sign in and each old one was
 * verified to be rejected.
 *
 * The passwords no longer live in the repository at all. They are supplied at
 * runtime through PACEMATE_DEMO_PASSWORDS, a JSON object of
 * `{ identifier: password }` read only on the server. A file that never contains
 * a credential cannot leak one again, whatever a future import does.
 *
 * FAIL CLOSED. The shortcut is inert unless BOTH PACEMATE_ENABLE_DEMO_LOGIN=1
 * and a matching entry in PACEMATE_DEMO_PASSWORDS are present. A deployment
 * that sets neither — production — has no reusable demo login at all.
 *
 * Post-Stage-10 UX restoration: the browser is now told only which ROLES are
 * available and posts a role back. Identifier and password are resolved here
 * through the pure policy in `demo-login-policy.ts`.
 */

export type { DemoLoginRole } from "@/config/demo-login-policy";

let cached: DemoPasswordTable | null | undefined;

function passwordTable(): DemoPasswordTable | null {
  if (cached === undefined) {
    cached = parseDemoPasswordTable(process.env.PACEMATE_DEMO_PASSWORDS);
  }
  return cached;
}

function currentConfig(): DemoLoginConfig {
  return {
    flag: process.env.PACEMATE_ENABLE_DEMO_LOGIN,
    table: passwordTable(),
    roster: demoUsers,
  };
}

/** True only when an operator has switched the shortcut on AND supplied credentials. */
export function isDemoLoginEnabled(): boolean {
  return process.env.PACEMATE_ENABLE_DEMO_LOGIN === "1" && passwordTable() !== null;
}

/**
 * What the browser is allowed to know: which roles can be demoed. Never an
 * identifier, never a credential. Only roles with a runtime credential are
 * offered, so the UI cannot advertise a login that would fail.
 */
export function listDemoLoginRoles(): DemoLoginRole[] {
  return listAvailableDemoLoginRoles(currentConfig());
}

/** Server-side only: resolve the identity and runtime password for a role. */
export function findDemoCredentialForRole(role: unknown): DemoCredential | null {
  return resolveDemoCredentialForRole(role, currentConfig());
}

/** Test seam: the table is memoised, so tests must be able to clear it. */
export function resetDemoPasswordCacheForTests(): void {
  cached = undefined;
}
