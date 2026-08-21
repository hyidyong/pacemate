/**
 * Role-based demo quick login — pure policy.
 *
 * The browser names a ROLE; this module decides, from server-side runtime
 * configuration only, whether that role can be signed in and as whom. It reads
 * nothing from the environment itself so that every fail-closed branch can be
 * executed in tests (see demo-login-policy.test.mjs). The server-only wrapper
 * in `demo-accounts.server.ts` supplies the real flag, table and roster.
 *
 * FAIL CLOSED. Absent flag, a flag other than the exact string "1", a missing
 * or malformed password table, an unknown role, or a role whose identity has no
 * runtime credential all yield "unavailable". There is no fallback credential.
 */

export const DEMO_LOGIN_ROLES = ["student", "professor", "assistant", "admin"] as const;

export type DemoLoginRole = (typeof DEMO_LOGIN_ROLES)[number];

export type DemoRosterEntry = {
  identifier: string;
  name: string;
  role: string;
};

export type DemoPasswordTable = Record<string, string>;

export type DemoLoginConfig = {
  /** Raw PACEMATE_ENABLE_DEMO_LOGIN value; only the exact string "1" enables. */
  flag: string | undefined;
  /** Parsed PACEMATE_DEMO_PASSWORDS, or null when absent/malformed. */
  table: DemoPasswordTable | null;
  /** The committed roster (identities and roles only, never credentials). */
  roster: readonly DemoRosterEntry[];
};

export type DemoCredential = {
  identifier: string;
  password: string;
};

export function isDemoLoginRole(value: unknown): value is DemoLoginRole {
  return typeof value === "string" && (DEMO_LOGIN_ROLES as readonly string[]).includes(value);
}

/** Parse the runtime password table; anything that is not a plain object disables the feature. */
export function parseDemoPasswordTable(raw: string | undefined): DemoPasswordTable | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as DemoPasswordTable)
      : null;
  } catch {
    return null;
  }
}

function isEnabled(config: DemoLoginConfig): boolean {
  return config.flag === "1" && config.table !== null;
}

function credentialFor(entry: DemoRosterEntry, table: DemoPasswordTable): DemoCredential | null {
  const password = table[entry.identifier];
  return typeof password === "string" && password.length > 0
    ? { identifier: entry.identifier, password }
    : null;
}

/**
 * Resolve the identity and runtime credential for a role, or null when the
 * feature is disabled, the role is invalid, or no credential is configured.
 */
export function resolveDemoCredentialForRole(
  role: unknown,
  config: DemoLoginConfig,
): DemoCredential | null {
  if (!isEnabled(config) || !isDemoLoginRole(role)) return null;
  const table = config.table as DemoPasswordTable;
  for (const entry of config.roster) {
    if (entry.role !== role) continue;
    const credential = credentialFor(entry, table);
    if (credential) return credential;
  }
  return null;
}

/** The roles the UI may offer — only those that would actually sign in. */
export function listAvailableDemoLoginRoles(config: DemoLoginConfig): DemoLoginRole[] {
  if (!isEnabled(config)) return [];
  return DEMO_LOGIN_ROLES.filter((role) => resolveDemoCredentialForRole(role, config) !== null);
}
