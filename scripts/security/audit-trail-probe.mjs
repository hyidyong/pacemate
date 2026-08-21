// Stage 9 (Codex F7 + F8) — live verification of the durable audit trail.
//
// Two questions this answers that migration-text guards cannot:
//
//   F7  are the service_role privileges REAL, and are the forbidden ones really
//       absent? The migrations now grant them explicitly, but "explicit in the
//       migration" and "true in this database" are different claims.
//   F8  does attribution survive the deletion of the actor it describes, and is
//       the table genuinely append-only — including for the service role?
//
// APPEND-ONLY MEANS THE PROBE CANNOT TIDY UP AFTER ITSELF (Codex round 3, F7).
// This probe used to delete its own rows, which is why service_role held DELETE
// on the audit trail — a production privilege kept for testing convenience.
// That privilege is gone. The probe now writes clearly marked test events and
// ACCEPTS that they remain in the trail permanently, which is what append-only
// means. They are REPORTED at the end, never silently ignored, and they contain
// no personal data. The disposable PROFILE this probe creates is still removed.
//
// Usage:
//   PACEMATE_SECURITY_PROBE_ALLOW_WRITES=1 \
//   PACEMATE_SECURITY_PROBE_PROJECT_REF=<ref> \
//   node scripts/security/audit-trail-probe.mjs

import { loadEnvLocal, requireEnv } from "../loadtest/lib/env.mjs";
import { assertSafeToProbe, createRunMarker } from "./lib/probe-guard.mjs";
import { createProbeRest } from "./lib/probe-rest.mjs";
import { createAbortScope, createRoleClient } from "./lib/probe-http.mjs";
import { createProbeLifecycle } from "./lib/probe-lifecycle.mjs";
import { ProbeLedger, sweepOrphans, verifyNoResidue } from "./lib/probe-ledger.mjs";

const MARKER = "stage9-audit-probe";
const RECOVERY_TIMEOUT_MS = Number(
  process.env.PACEMATE_SECURITY_PROBE_RECOVERY_TIMEOUT_MS ?? 30000,
);

async function main() {
  const env = loadEnvLocal();
  const url = requireEnv(env, "NEXT_PUBLIC_SUPABASE_URL").replace(/\/$/, "");
  const anonKey = requireEnv(env, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  const serviceKey = requireEnv(env, "SUPABASE_SERVICE_ROLE_KEY");

  assertSafeToProbe({ ...env, ...process.env }, url);

  // Codex round 4, finding 7. This probe was the last one still using a bare
  // `fetch` with no deadline, ad-hoc teardown that swallowed its own failures
  // (`.catch(() => {})`), and no signal handling at all. It now shares the same
  // harness as every other probe: bounded transport, one cancellation scope,
  // a caller-owned ledger, and signal-aware cleanup that cannot report success
  // it did not observe.
  const scope = createAbortScope();
  // Codex round 5, F6: ownership is execution-specific.
  const runMarker = createRunMarker();
  const rest = createProbeRest({ url, serviceRoleKey: serviceKey, scope });
  const asAnon = createRoleClient({
    url,
    baseHeaders: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, "Content-Type": "application/json" },
    scopeSignal: scope.signal,
    scope,
  });

  const results = [];
  const check = (id, property, pass, detail) => results.push({ id, property, pass, detail });

  // AUDIT ROWS ARE NEVER LEDGERED. service_role holds only INSERT and SELECT on
  // security_events (20260814140000), so the ledger could not delete them even
  // if it tried — and granting DELETE to make the harness tidy is exactly the
  // trade this stage refused. They stay, and they are reported. Only the
  // disposable PROFILE is a ledgered resource.
  const created = { events: [] };
  const ledger = new ProbeLedger({ rest, auth: null });

  const cleanupDisposable = async ({ sweep = false } = {}) => {
    const failures = await ledger.cleanup();
    for (const failure of failures) {
      console.error(`[CLEANUP FAILED] ${failure.table} ${failure.id}: ${failure.message}`);
    }
    let sweepFailures = [];
    if (sweep) {
      const swept = await sweepOrphans({ rest, auth: null, runMarker });
      sweepFailures = swept.failures;
      for (const entry of swept.removed) console.error(`[SWEPT] ${entry}`);
      for (const entry of sweepFailures) console.error(`[SWEEP FAILED] ${entry}`);
    }
    // The shared residue check knows nothing about this probe's own marker, so
    // the disposable profile carries the run marker and is covered here.
    const residue = await verifyNoResidue({ rest, auth: null, runMarker });
    // This probe creates no auth users, so the missing auth client is expected.
    const unverifiable = residue.unverifiable.filter((entry) => !entry.startsWith("auth.users:"));
    for (const entry of residue.residue) console.error(`[RESIDUE] ${entry}`);
    for (const entry of unverifiable) console.error(`[UNVERIFIABLE] ${entry}`);
    const ok =
      failures.length === 0 &&
      sweepFailures.length === 0 &&
      residue.residue.length === 0 &&
      unverifiable.length === 0;
    return { ok, detail: ok ? "clean" : "residue, sweep, or cleanup failure" };
  };

  const lifecycle = createProbeLifecycle({
    abortWork: (reason) => scope.abort(reason),
    awaitMutations: (ms) => scope.settled(ms),
    recoverAmbiguous: async ({ quiesce }) => {
      if (!quiesce.bodyStopped) {
        return {
          ok: false,
          detail: `body still active; recover with node scripts/security/rls-probe.mjs --sweep --run ${runMarker}`,
        };
      }
      const settled = await scope.settled(RECOVERY_TIMEOUT_MS);
      const result = await cleanupDisposable({ sweep: true });
      if (!settled.ok) {
        return {
          ok: false,
          detail:
            `exact-run recovery ${result.ok ? "removed all observed residue" : result.detail}, but ` +
            `${settled.ambiguous ?? 0} mutation outcome(s) remain unacknowledged and ` +
            `${settled.outstanding} mutation(s) remain in flight; recover with ` +
            `node scripts/security/rls-probe.mjs --sweep --run ${runMarker}`,
        };
      }
      return result;
    },
    cleanup: cleanupDisposable,
  });

  const { bodyError } = await lifecycle.run(async () => {
    // ---- F7: required privileges are present -----------------------------
    const [event] = await rest.insert("security_events", [
      { event: `${MARKER}.append`, outcome: "ok", subject_type: "verification", detail: MARKER },
    ]);
    created.events.push(event.id);
    check("f7:service-role-append", "service_role CAN append to the audit trail", Boolean(event?.id), `id ${event?.id ?? "none"}`);

    const readBack = await rest.select("security_events", `select=id&id=eq.${event.id}`);
    check("f7:service-role-read", "service_role CAN read the audit trail", readBack.length === 1, `${readBack.length} row(s)`);

    // ---- F7: forbidden privileges are absent -----------------------------
    let res = await asAnon("security_events?select=id&limit=5");
    const anonRows = Array.isArray(res.body) ? res.body : [];
    check(
      "f7:anon-cannot-read",
      "anon CANNOT read the audit trail",
      res.status >= 400 || anonRows.length === 0,
      `status ${res.status}`,
    );

    res = await asAnon("security_events", {
      method: "POST",
      body: JSON.stringify({ event: `${MARKER}.forged`, outcome: "ok" }),
    });
    check("f7:anon-cannot-append", "anon CANNOT append", res.status >= 400, `status ${res.status}`);

    res = await asAnon(`security_events?id=eq.${event.id}`, {
      method: "PATCH",
      body: JSON.stringify({ detail: "tampered" }),
    });
    check("f7:anon-cannot-update", "anon CANNOT rewrite history", res.status >= 400, `status ${res.status}`);

    res = await asAnon(`security_events?id=eq.${event.id}`, { method: "DELETE" });
    check("f7:anon-cannot-delete", "anon CANNOT delete history", res.status >= 400, `status ${res.status}`);

    // ---- F8: append-only holds even for the service role -----------------
    let updateRejected = false;
    try {
      await rest.update("security_events", `id=eq.${event.id}`, { detail: "tampered" });
    } catch {
      updateRejected = true;
    }
    const [afterUpdate] = await rest.select("security_events", `select=detail&id=eq.${event.id}`);
    check(
      "f8:append-only",
      "an audit record cannot be UPDATED, even by the service role",
      updateRejected && afterUpdate?.detail === MARKER,
      `rejected=${updateRejected}, detail=${JSON.stringify(afterUpdate?.detail)}`,
    );

    // ---- F8: attribution survives deletion of the actor ------------------
    const [school] = await rest.select("schools", "select=id&limit=1");
    const [disposable] = await rest.insert("profiles", [
      {
        identifier: `${runMarker}-${MARKER}-actor@probe.invalid`,
        name: `${runMarker} ${MARKER} disposable actor`,
        role: "student",
        school_id: school.id,
      },
    ]);
    ledger.recordRow("profiles", disposable.id, "disposable audit actor");

    const [attributed] = await rest.insert("security_events", [
      {
        event: `${MARKER}.attribution`,
        outcome: "ok",
        actor_profile_id: disposable.id,
        school_id: school.id,
        actor_role: "student",
        detail: MARKER,
      },
    ]);
    created.events.push(attributed.id);

    check(
      "f8:snapshot-populated",
      "the attribution snapshot is written automatically at event time",
      attributed.actor_ref === disposable.id &&
        attributed.school_ref === school.id &&
        attributed.actor_role_ref === "student",
      `actor_ref=${attributed.actor_ref ? "set" : "null"} school_ref=${attributed.school_ref ? "set" : "null"} role_ref=${attributed.actor_role_ref}`,
    );

    // Deleting the actor must SUCCEED (the audit trail must not become a lock on
    // user deletion) and must NOT damage the record.
    let deletionSucceeded = true;
    try {
      await rest.remove("profiles", `id=eq.${disposable.id}`);
      // Removed as part of the TEST, so drop it from the ledger — otherwise
      // cleanup would report a failure for a row the probe deliberately deleted.
      ledger.entries = ledger.entries.filter((entry) => entry.id !== disposable.id);
    } catch {
      deletionSucceeded = false;
    }
    check(
      "f8:actor-deletable",
      "a profile carrying audit history can still be deleted",
      deletionSucceeded,
      deletionSucceeded ? "deleted" : "DELETE BLOCKED by the audit trail",
    );

    const [afterDeletion] = await rest.select(
      "security_events",
      `select=actor_profile_id,actor_ref,school_ref,actor_role_ref&id=eq.${attributed.id}`,
    );
    check(
      "f8:attribution-survives",
      "actor deletion does not erase the audit record's attribution",
      afterDeletion?.actor_ref === disposable.id && afterDeletion?.actor_role_ref === "student",
      `actor_ref=${afterDeletion?.actor_ref === disposable.id ? "PRESERVED" : "LOST"}, role_ref=${afterDeletion?.actor_role_ref}`,
    );
  });

  const cleanup = lifecycle.cleanupResult ?? { ok: false, detail: "cleanup did not run" };

  // The append-only guarantee itself, proven rather than asserted.
  if (created.events.length) {
    let deleteRefused = false;
    try {
      await rest.remove("security_events", `id=eq.${created.events[0]}`);
    } catch {
      deleteRefused = true;
    }
    const [survivor] = await rest
      .select("security_events", `select=id&id=eq.${created.events[0]}`)
      .catch(() => []);
    check(
      "f7:delete-refused",
      "an audit record cannot be DELETED, even by the service role",
      deleteRefused && Boolean(survivor),
      `refused=${deleteRefused}, row ${survivor ? "survives" : "GONE"}`,
    );
  }

  const auditEvents = await rest.select("security_events", `select=id&event=like.${MARKER}*`).catch(() => null);
  check(
    "cleanup:disposable",
    "every DISPOSABLE resource is removed and the check can be performed",
    cleanup.ok,
    cleanup.detail,
  );
  // Not a leak: audit rows are permanent by design. Reported so the count is
  // visible and nobody mistakes them for production events.
  console.log(
    `
Audit trail: ${auditEvents === null ? "UNKNOWN" : auditEvents.length} permanent test event(s) ` +
      `marked "${MARKER}" remain by design (the trail is append-only).`,
  );

  console.log("\n=== Stage 9 durable audit trail probe ===\n");
  let failed = 0;
  for (const r of results) {
    if (!r.pass) failed += 1;
    console.log(`[${r.pass ? "PASS" : "FAIL"}] ${r.id}\n        ${r.property}\n        ${r.detail}`);
  }
  console.log(`\n${results.length} checks, ${failed} FAILED.`);
  if (bodyError) console.error(`\nAborted: ${bodyError.message}`);

  // A run that aborted part-way through must never read as success, and neither
  // must one whose cleanup could not be proven.
  const EXPECTED_CHECKS = 12;
  const ranEverything = results.length === EXPECTED_CHECKS;
  if (!ranEverything) console.error(`Only ${results.length} of ${EXPECTED_CHECKS} checks ran.`);

  process.exit(failed === 0 && cleanup.ok && !bodyError && ranEverything ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
