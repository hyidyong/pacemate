import "server-only";

import demoUsers from "@/config/demo-users.json";

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
 */

export type DemoAccountSummary = {
  identifier: string;
  name: string;
  role: string;
};

let cached: Record<string, string> | null | undefined;

function passwordTable(): Record<string, string> | null {
  if (cached !== undefined) return cached;
  const raw = process.env.PACEMATE_DEMO_PASSWORDS;
  if (!raw) {
    cached = null;
    return cached;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    cached =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, string>)
        : null;
  } catch {
    // A malformed value disables the shortcut rather than half-enabling it.
    cached = null;
  }
  return cached;
}

/** True only when an operator has switched the shortcut on AND supplied credentials. */
export function isDemoLoginEnabled(): boolean {
  return process.env.PACEMATE_ENABLE_DEMO_LOGIN === "1" && passwordTable() !== null;
}

/**
 * What the browser is allowed to know: who the accounts are, never how to
 * authenticate as them. Only accounts that actually have a runtime credential
 * are offered, so the UI cannot advertise a login that would fail.
 */
export function listDemoAccounts(): DemoAccountSummary[] {
  if (!isDemoLoginEnabled()) return [];
  const table = passwordTable() ?? {};
  return demoUsers
    .filter((user) => typeof table[user.identifier] === "string" && table[user.identifier].length > 0)
    .map((user) => ({ identifier: user.identifier, name: user.name, role: user.role }));
}

/** Server-side only: resolve the runtime password for a roster identifier. */
export function findDemoPassword(identifier: string): string | null {
  if (!isDemoLoginEnabled()) return null;
  const password = (passwordTable() ?? {})[identifier];
  return typeof password === "string" && password.length > 0 ? password : null;
}

/** Test seam: the table is memoised, so tests must be able to clear it. */
export function resetDemoPasswordCacheForTests(): void {
  cached = undefined;
}
