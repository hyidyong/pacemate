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

import { assertScopedFilter, ownedByRun } from "./probe-guard.mjs";

/**
 * Tables the sweep and the residue check know about, with the text column that
 * carries PROBE_MARKER. Order is creation order; cleanup walks it backwards.
 */
/**
 * Tables the sweep and the residue check know about, with the text column that
 * carries this RUN's marker. Order is creation order; cleanup walks it backwards.
 *
 * Codex round 5, F6: this used to be a table of literal `like.*fixed-marker*`
 * predicates — a SUBSTRING match on a string shared by every execution. A real
 * post whose text merely contained the phrase would have been deleted by a
 * sweep that never created it. The predicate is now built per run, by PREFIX,
 * from a 128-bit random token, so ownership is provable.
 */
export const MARKED_COLUMNS = [
  ["schools", "slug"],
  ["departments", "name"],
  ["professors", "name"],
  ["courses", "name"],
  ["profiles", "identifier"],
  ["counseling_requests", "topic"],
  ["student_courses", "source_text"],
  ["student_mission_progress", "actual_progress_feedback"],
  ["user_notifications", "title"],
  // These four are written by the cross-tenant WRITE probes rather than by
  // provisioning, and they were missing from this list. That mattered: their
  // parent foreign keys are ON DELETE SET NULL, so deleting the probe tenant
  // does NOT remove them — a live run left 4 posts and 2 course_reviews behind
  // while residue verification reported clean. A table the probe can write to
  // must be a table residue verification looks at.
  ["study_roadmaps", "title"],
  ["study_tasks", "title"],
  ["posts", "title"],
  ["course_reviews", "content"],
  ["roadmap_revision_requests", "title"],
  ["faqs", "question"],
];

/** [table, column, predicate] for one specific execution. */
export function markedTablesFor(runMarker) {
  const predicate = ownedByRun(runMarker);
  return MARKED_COLUMNS.map(([table, column]) => [table, column, predicate]);
}

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
export async function verifyNoResidue({ rest, auth, runMarker }) {
  const residue = [];
  const unverifiable = [];

  for (const [table, column, predicate] of markedTablesFor(runMarker)) {
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
    const parents = await rest.select("profiles", `select=id&identifier=${ownedByRun(runMarker)}`);
    if (Array.isArray(parents) && parents.length) {
      residue.push(`student_profiles: ${parents.length} orphaned parent profile(s)`);
    }
  } catch (error) {
    unverifiable.push(`student_profiles(parent): ${error?.message ?? error}`);
  }

  if (auth) {
    try {
      const users = await auth.listUsersByEmailPrefix(runMarker);
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
 * Codex round 4, 4C — the standard three-phase teardown every probe uses.
 *
 * The ledger alone is not sufficient, because it can only remove what it KNOWS
 * about. A create request that times out may still have committed on the
 * server: the row exists, the probe never learned its id, and the ledger has
 * nothing to delete. `ProbeRequestError.ambiguous` marks exactly that case.
 *
 * So the sweep is no longer operator-only. It runs automatically after the
 * ledger, keyed on PROBE_MARKER, and finds anything the ledger could not name —
 * including residue left by an earlier run that was killed outright.
 *
 * A run is clean only when ALL THREE agree:
 *
 *   1. ledger cleanup removed everything it recorded,
 *   2. the marker sweep completed without failures,
 *   3. residue verification finds nothing and could actually be PERFORMED.
 *
 * Anything the sweep removes is reported. Silently deleting rows the ledger
 * never recorded would hide the very ambiguity this exists to surface.
 */
export async function teardown({ ledger, rest, auth, runMarker, logger = console }) {
  const failures = await ledger.cleanup();
  for (const failure of failures) {
    logger.error(`[CLEANUP FAILED] ${failure.table} ${failure.id}: ${failure.message}`);
  }

  const swept = await sweepOrphans({ rest, auth, runMarker });
  for (const entry of swept.removed) {
    logger.error(`[SWEPT] ${entry} — not in the ledger; an ambiguous create or an earlier crash`);
  }
  for (const entry of swept.failures) {
    logger.error(`[SWEEP FAILED] ${entry}`);
  }

  const residue = await verifyNoResidue({ rest, auth, runMarker });
  for (const entry of residue.residue) logger.error(`[RESIDUE] ${entry}`);
  for (const entry of residue.unverifiable) logger.error(`[UNVERIFIABLE] ${entry}`);

  const ok = failures.length === 0 && swept.failures.length === 0 && residue.clean;
  const detail = ok
    ? swept.removed.length
      ? `clean, after sweeping ${swept.removed.length} unledgered item(s)`
      : "clean"
    : [
        failures.length ? `${failures.length} cleanup failure(s)` : null,
        swept.failures.length ? `${swept.failures.length} sweep failure(s)` : null,
        residue.residue.length ? `${residue.residue.length} residue item(s)` : null,
        residue.unverifiable.length ? `${residue.unverifiable.length} unverifiable check(s)` : null,
      ]
        .filter(Boolean)
        .join("; ");

  return { ok, detail, failures, swept, residue };
}

/**
 * Independent recovery for the case `finally` cannot cover (SIGKILL, crash,
 * power loss). Also called automatically by `teardown` above, because a
 * timed-out create can commit without the ledger ever learning its id. Deletes
 * marked rows in reverse dependency order and removes marked auth users.
 */
export async function sweepOrphans({ rest, auth, runMarker }) {
  const removed = [];
  const failures = [];

  for (const [table, column, predicate] of [...markedTablesFor(runMarker)].reverse()) {
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
      const users = await auth.listUsersByEmailPrefix(runMarker);
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
