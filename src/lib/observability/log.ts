/**
 * Structured logging (Stage 8 P2).
 *
 * The app had 70 free-form `console.*` calls, no request correlation, and no
 * way to tell a business conflict from a system fault in the logs. Vercel
 * captures stdout, so one JSON line per event is queryable there today and
 * drainable to any sink later — no APM vendor, no metrics backend, no new
 * dependency.
 *
 * Fields are ALLOWLISTED, generalizing the discipline `src/lib/sso/sso-audit.ts`
 * already proves works: an unknown key is dropped rather than serialized, so a
 * future caller cannot casually widen the log surface and leak PII.
 *
 * Never log: passwords, access/refresh tokens, client secrets, authorization
 * codes, raw SSO assertions, cookies, `profiles.identifier` (it IS the email),
 * display names, notification bodies, raw Postgres `detail` strings (they can
 * embed row values), or third-party error bodies.
 */

export type LogLevel = "info" | "warn" | "error";

/**
 * Error taxonomy. Separating these is what makes alerting possible: a slot that
 * is already taken is the system working correctly and must not page anyone,
 * while a storage failure on the same code path must.
 */
export type LogOutcome =
  | "ok"
  /** The system worked; the answer is legitimately "no" (slot taken, CAS miss). */
  | "conflict"
  /** Authorization refusal — expected, worth a rate, not a page. */
  | "denied"
  /** Invalid input or insufficient role. */
  | "user_error"
  /** The system failed. This is the one that should page. */
  | "fault";

export type LogEvent = {
  event: string;
  level?: LogLevel;
  outcome?: LogOutcome;
  requestId?: string;
  route?: string;
  /** schools.id — safe: an opaque uuid, and the dimension operators filter by. */
  tenantId?: string;
  /** profiles.id — safe: pseudonymous uuid. NEVER profiles.identifier. */
  profileId?: string;
  /** Postgres/PostgREST code such as 23P01, PGRST116, 42501. */
  code?: string;
  durationMs?: number;
  /** Short, non-sensitive descriptor. Never an upstream error body. */
  detail?: string;
};

const ALLOWED_FIELDS = [
  "event",
  "level",
  "outcome",
  "requestId",
  "route",
  "tenantId",
  "profileId",
  "code",
  "durationMs",
  "detail",
] as const satisfies ReadonlyArray<keyof LogEvent>;

/**
 * Pure: builds the record that would be emitted. Exported so tests can assert
 * the shape and the allowlist without capturing stdout.
 */
export function buildLogRecord(event: LogEvent, now = new Date()): Record<string, unknown> {
  const record: Record<string, unknown> = { ts: now.toISOString() };

  for (const field of ALLOWED_FIELDS) {
    const value = event[field];
    if (value !== undefined && value !== null && value !== "") {
      record[field] = value;
    }
  }

  record.level = event.level ?? defaultLevelFor(event.outcome);
  return record;
}

function defaultLevelFor(outcome: LogOutcome | undefined): LogLevel {
  if (outcome === "fault") return "error";
  if (outcome === "denied" || outcome === "conflict") return "warn";
  return "info";
}

export function logEvent(event: LogEvent, now = new Date()) {
  const record = buildLogRecord(event, now);
  const line = JSON.stringify(record);

  // Route by level so platform log filters (and any future drain) can separate
  // faults from routine events without parsing.
  if (record.level === "error") {
    console.error(line);
  } else if (record.level === "warn") {
    console.warn(line);
  } else {
    console.info(line);
  }
}

/**
 * Maps a PostgREST/Postgres error code to the taxonomy. Booking conflicts
 * (23P01 exclusion, 23505 unique) and empty compare-and-set results (PGRST116)
 * are the system behaving correctly under contention — never faults.
 */
export function classifyPostgresError(code: string | null | undefined): LogOutcome {
  if (!code) return "fault";
  if (code === "23P01" || code === "23505") return "conflict";
  if (code === "PGRST116") return "conflict";
  if (code === "42501") return "denied";
  return "fault";
}
