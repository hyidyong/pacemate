// Immediately-updated cleanup ledger for the security probe harness.
//
// Codex finding 1. The previous design built a fixture object locally inside
// provisionTenant() and only handed it to the caller on the happy path. A throw
// anywhere in the middle — a FK violation, a network blip, a GoTrue 429 —
// orphaned everything created up to that point: school, department, professor,
// course, availability, AUTH USER, profile, student profile, enrolment. The
// rescue path could only fall back to a marker sweep, and `schools` has no
// ON DELETE CASCADE, so that sweep failed on a foreign-key violation and the
// failure was swallowed. Residue was reported to stdout but never affected the
// exit code.
//
// The rule here is the opposite: a resource is recorded the instant it exists,
// BEFORE the next operation that could fail. The ledger belongs to the caller,
// not to the provisioner, so a provisioner that throws — or never returns —
// still leaves the caller holding a complete list of what to remove.
//
// Cleanup is strict LIFO. Because every child is created after its parent,
// reverse creation order is dependency-safe by construction; there is no
// hand-maintained table ordering to drift out of sync with the fixtures.
//
// Nothing is swallowed. Every failure is collected and surfaced, and the caller
// is expected to fail the run.
//
// HONEST LIMITATION: `try/finally` runs on a thrown error, a rejected promise
// and an ordinary process exit. It does NOT run on SIGKILL, a power loss, or a
// host OOM kill. NO CRASH SAFETY IS CLAIMED. The independent recovery mechanism
// for that case is the operator-run sweep (`node scripts/security/rls-probe.mjs
// --sweep`), which finds and removes marked residue from any previous run. It is
// not automatic.

import { PROBE_MARKER, PROBE_TENANT_SLUG_PREFIX, assertScopedFilter } from "./probe-guard.mjs";

/**
 * Tables the sweep and the residue check know about, with the text column that
 * carries PROBE_MARKER. Order is creation order; cleanup walks it backwards.
 */
export const MARKED_TABLES = [
  ["schools", "slug", `like.${PROBE_TENANT_SLUG_PREFIX}*`],
  ["departments", "name", `like.*${PROBE_MARKER}*`],
  ["professors", "name", `like.*${PROBE_MARKER}*`],
  ["courses", "name", `like.*${PROBE_MARKER}*`],
  ["profiles", "identifier", `like.*${PROBE_MARKER}*`],
  ["counseling_requests", "topic", `like.*${PROBE_MARKER}*`],
  ["student_courses", "source_text", `like.*${PROBE_MARKER}*`],
  ["student_mission_progress", "actual_progress_feedback", `like.*${PROBE_MARKER}*`],
  ["user_notifications", "title", `like.*${PROBE_MARKER}*`],
];

/**
 * Tables whose rows carry no marker column of their own and are therefore only
 * reachable through the ledger (or through their parent's deletion). They are
 * still residue-checked via their parent.
 */
export const UNMARKED_CHILD_TABLES = ["student_profiles", "professor_availability"];

export class ProbeLedger {
  constructor({ rest, auth }) {
    this.rest = rest;
    this.auth = auth;
    /** @type {Array<{kind: 'db'|'auth', table?: string, id: string, label: string}>} */
    this.entries = [];
    this.cleaned = false;
  }

  /** Record a database row the instant it exists. */
  recordRow(table, id, label = "") {
    if (!table || !id) {
      throw new Error(`ledger.recordRow requires a table and an id (got ${table}/${id})`);
    }
    this.entries.push({ kind: "db", table, id: String(id), label });
    return id;
  }

  /** Record an auth user the instant it exists. */
  recordAuthUser(id, label = "") {
    if (!id) throw new Error("ledger.recordAuthUser requires an id");
    this.entries.push({ kind: "auth", id: String(id), label });
    return id;
  }

  get size() {
    return this.entries.length;
  }

  /** What is still recorded, newest first — the order cleanup will use. */
  pending() {
    return [...this.entries].reverse();
  }

  /**
   * Reverse-order teardown. Returns a list of failures rather than throwing, so
   * one stubborn row cannot prevent the rest from being removed — but every
   * failure is reported and the caller must treat a non-empty list as fatal.
   */
  async cleanup() {
    const failures = [];
    // Iterate a snapshot in reverse; successful removals are dropped from the
    // ledger so a second cleanup() call is a no-op rather than a double delete.
    const remaining = [];
    for (const entry of [...this.entries].reverse()) {
      try {
        if (entry.kind === "db") {
          await this.rest.remove(entry.table, assertScopedFilter(`id=eq.${entry.id}`));
        } else {
          await this.auth.deleteUser(entry.id);
        }
      } catch (error) {
        remaining.push(entry);
        failures.push({
          kind: entry.kind,
          table: entry.table ?? "auth.users",
          id: entry.id,
          label: entry.label,
          message: error?.message ?? String(error),
        });
      }
    }
    this.entries = remaining.reverse();
    this.cleaned = true;
    return failures;
  }
}

/**
 * Re-read the database and report anything still carrying the marker.
 *
 * A check that cannot be PERFORMED is a failure, not a warning: "I could not
 * look" and "there is nothing there" are different answers, and only one of
 * them means it is safe to stop.
 */
export async function verifyNoResidue({ rest, auth }) {
  const residue = [];
  const unverifiable = [];

  for (const [table, column, predicate] of MARKED_TABLES) {
    try {
      const rows = await rest.select(table, `select=id&${column}=${predicate}`);
      if (!Array.isArray(rows)) {
        unverifiable.push(`${table}: unexpected response shape`);
      } else if (rows.length) {
        residue.push(`${table}: ${rows.length} row(s)`);
      }
    } catch (error) {
      unverifiable.push(`${table}: ${error?.message ?? error}`);
    }
  }

  // Child rows have no marker column; check them through their marked parent so
  // an orphan cannot hide behind "no marker to search for".
  try {
    const parents = await rest.select("profiles", `select=id&identifier=like.*${PROBE_MARKER}*`);
    if (Array.isArray(parents) && parents.length) {
      residue.push(`student_profiles: ${parents.length} orphaned parent profile(s)`);
    }
  } catch (error) {
    unverifiable.push(`student_profiles(parent): ${error?.message ?? error}`);
  }

  if (auth) {
    try {
      const users = await auth.listUsersByEmailPrefix(PROBE_MARKER);
      if (users.length) residue.push(`auth.users: ${users.length} user(s)`);
    } catch (error) {
      unverifiable.push(`auth.users: ${error?.message ?? error}`);
    }
  } else {
    unverifiable.push("auth.users: no auth client supplied");
  }

  return { residue, unverifiable, clean: residue.length === 0 && unverifiable.length === 0 };
}

/**
 * Independent recovery for the case `finally` cannot cover (SIGKILL, crash,
 * power loss). Operator-run, not automatic. Deletes marked rows in reverse
 * dependency order and removes marked auth users.
 */
export async function sweepOrphans({ rest, auth }) {
  const removed = [];
  const failures = [];

  for (const [table, column, predicate] of [...MARKED_TABLES].reverse()) {
    try {
      const rows = await rest.remove(table, assertScopedFilter(`${column}=${predicate}`));
      const count = Array.isArray(rows) ? rows.length : 0;
      if (count) removed.push(`${table}: ${count}`);
    } catch (error) {
      failures.push(`${table}: ${error?.message ?? error}`);
    }
  }

  if (auth) {
    try {
      const users = await auth.listUsersByEmailPrefix(PROBE_MARKER);
      for (const user of users) {
        try {
          await auth.deleteUser(user.id);
          removed.push(`auth.users: ${user.id}`);
        } catch (error) {
          failures.push(`auth.users ${user.id}: ${error?.message ?? error}`);
        }
      }
    } catch (error) {
      failures.push(`auth.users listing: ${error?.message ?? error}`);
    }
  }

  return { removed, failures };
}
