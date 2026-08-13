// Live RLS verification for user_notifications.
//
// Codex round 3, F1: this script mutated a live project with none of the
// protections the main probe had gained — no production/host guard, no cleanup
// ledger, no bounded transport, and residue that could not fail the run. Two of
// its checks also passed when their FIXTURE WAS MISSING ("SKIPPED — no direct
// row exists"), which is a security assertion reporting success for a test that
// never ran. It also signed in as a real demo account, so it depended on
// production data being in a particular shape.
//
// It now shares the probe harness's guarantees:
//   * the same host/production guard (privileged credentials only to an exact
//     Supabase project host, over HTTPS);
//   * the same bounded transport, whose deadline covers body consumption;
//   * the same cleanup ledger, recording each resource the moment it exists;
//   * the same signal-aware, once-only cleanup;
//   * fatal residue — a run that cannot prove it cleaned up exits non-zero;
//   * POSITIVE FIXTURES: it provisions its own tenants, user and rows, so a
//     missing fixture is a failure rather than a pass, and it never touches an
//     existing tenant or user.
//
// Usage:
//   PACEMATE_SECURITY_PROBE_ALLOW_WRITES=1 \
//   PACEMATE_SECURITY_PROBE_PROJECT_REF=<ref> \
//   node scripts/verify-notification-rls.mjs

import { loadEnvLocal, requireEnv } from "./loadtest/lib/env.mjs";
import {
  PROBE_MARKER,
  PROBE_TENANT_SLUG_PREFIX,
  assertSafeToProbe,
} from "./security/lib/probe-guard.mjs";
import { createProbeAuthAdmin, createProbeRest, signInFactory } from "./security/lib/probe-rest.mjs";
import { createRoleClient } from "./security/lib/probe-http.mjs";
import { ProbeLedger, verifyNoResidue } from "./security/lib/probe-ledger.mjs";
import { createProbeLifecycle } from "./security/lib/probe-lifecycle.mjs";

const PROBE_PASSWORD = "Stage9-notif-probe-!aA9";
const TIMEOUT_MS = Number(process.env.PACEMATE_SECURITY_PROBE_TIMEOUT_MS ?? 15000);
const EXPECTED_CHECKS = 6;

async function main() {
  const env = loadEnvLocal();
  const url = requireEnv(env, "NEXT_PUBLIC_SUPABASE_URL").replace(/\/$/, "");
  const anonKey = requireEnv(env, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  const serviceKey = requireEnv(env, "SUPABASE_SERVICE_ROLE_KEY");

  assertSafeToProbe({ ...env, ...process.env }, url);

  const rest = createProbeRest({ url, serviceRoleKey: serviceKey, timeoutMs: TIMEOUT_MS });
  const auth = createProbeAuthAdmin({ url, serviceRoleKey: serviceKey, timeoutMs: TIMEOUT_MS });
  const signIn = signInFactory({ url, anonKey, timeoutMs: TIMEOUT_MS });
  const asAnon = createRoleClient({
    url,
    baseHeaders: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, "Content-Type": "application/json" },
    timeoutMs: TIMEOUT_MS,
  });

  const results = [];
  const check = (id, property, pass, detail) => results.push({ id, property, pass, detail });

  const ledger = new ProbeLedger({ rest, auth });
  const lifecycle = createProbeLifecycle({
    cleanup: async () => {
      const failures = await ledger.cleanup();
      const residue = await verifyNoResidue({ rest, auth });
      const ok = failures.length === 0 && residue.clean;
      if (!ok) {
        for (const failure of failures) {
          console.error(`[CLEANUP FAILED] ${failure.table} ${failure.id}: ${failure.message}`);
        }
        for (const entry of residue.residue) console.error(`[RESIDUE] ${entry}`);
        for (const entry of residue.unverifiable) console.error(`[UNVERIFIABLE] ${entry}`);
      }
      return { ok, detail: ok ? "clean" : "residue or cleanup failure" };
    },
  });

  const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  const { bodyError } = await lifecycle.run(async () => {
    const record = async (table, row) => {
      const [created] = await rest.insert(table, [row]);
      ledger.recordRow(table, created.id, table);
      return created;
    };

    const home = await record("schools", {
      name: `${PROBE_MARKER} notif home`,
      slug: `${PROBE_TENANT_SLUG_PREFIX}notif-home-${runId}`,
      status: "active",
    });
    const foreign = await record("schools", {
      name: `${PROBE_MARKER} notif foreign`,
      slug: `${PROBE_TENANT_SLUG_PREFIX}notif-foreign-${runId}`,
      status: "active",
    });

    const email = `${PROBE_MARKER}-notif-${runId}@probe.invalid`;
    const authUser = await auth.createUser(email, PROBE_PASSWORD);
    ledger.recordAuthUser(authUser.id, "notif student");

    const profile = await record("profiles", {
      identifier: email,
      name: `${PROBE_MARKER} notif student`,
      role: "student",
      school_id: home.id,
      auth_user_id: authUser.id,
    });

    const own = await record("user_notifications", {
      recipient_id: profile.id,
      recipient_role: null,
      school_id: home.id,
      category: "system",
      title: `${PROBE_MARKER} own direct ${runId}`,
      body: `${PROBE_MARKER} own direct body`,
      target_href: "/notifications",
    });
    const sameTenant = await record("user_notifications", {
      recipient_id: null,
      recipient_role: "student",
      school_id: home.id,
      category: "system",
      title: `${PROBE_MARKER} same tenant broadcast ${runId}`,
      body: `${PROBE_MARKER} same tenant body`,
      target_href: "/notifications",
    });
    const foreignBroadcast = await record("user_notifications", {
      recipient_id: null,
      recipient_role: "student",
      school_id: foreign.id,
      category: "system",
      title: `${PROBE_MARKER} foreign broadcast ${runId}`,
      body: `${PROBE_MARKER} foreign body`,
      target_href: "/notifications",
    });

    const token = await signIn(email, PROBE_PASSWORD);
    const asStudent = createRoleClient({
      url,
      baseHeaders: {
        apikey: anonKey,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      timeoutMs: TIMEOUT_MS,
    });

    {
      const { status, body } = await asAnon("user_notifications?select=id&limit=5");
      check(
        "anon-read",
        "an unauthenticated caller reads no notifications",
        status !== 200 || (Array.isArray(body) && body.length === 0),
        `status ${status}, ${Array.isArray(body) ? body.length : "n/a"} row(s)`,
      );
    }
    {
      const { status, body } = await asStudent(`user_notifications?select=id&id=eq.${own.id}`);
      check(
        "own-direct",
        "the student CAN read their own direct notification (positive fixture)",
        status === 200 && Array.isArray(body) && body.length === 1,
        `status ${status}, ${Array.isArray(body) ? body.length : "n/a"} row(s)`,
      );
    }
    {
      const { status, body } = await asStudent(`user_notifications?select=id&id=eq.${sameTenant.id}`);
      check(
        "same-tenant-broadcast",
        "the student CAN read a same-tenant role broadcast (positive fixture)",
        status === 200 && Array.isArray(body) && body.length === 1,
        `status ${status}, ${Array.isArray(body) ? body.length : "n/a"} row(s)`,
      );
    }
    {
      const { status, body } = await asStudent(
        `user_notifications?select=id&id=eq.${foreignBroadcast.id}`,
      );
      check(
        "cross-tenant-read",
        "the student must NOT read another tenant's role broadcast",
        status === 200 && Array.isArray(body) && body.length === 0,
        `status ${status}, ${Array.isArray(body) ? body.length : "n/a"} row(s)`,
      );
    }
    {
      // Outcome read back with the service role, never inferred from the
      // response representation.
      const { status } = await asStudent(`user_notifications?id=eq.${foreignBroadcast.id}`, {
        method: "PATCH",
        body: JSON.stringify({ is_read: true }),
      });
      const [after] = await rest.select(
        "user_notifications",
        `select=is_read&id=eq.${foreignBroadcast.id}`,
      );
      check(
        "cross-tenant-update",
        "the student must NOT mark another tenant's broadcast read",
        after?.is_read === false,
        `PATCH ${status}; is_read is now ${after?.is_read}`,
      );
    }
    {
      const { status } = await asStudent(`user_notifications?id=eq.${own.id}`, {
        method: "PATCH",
        body: JSON.stringify({ is_read: true }),
      });
      const [after] = await rest.select("user_notifications", `select=is_read&id=eq.${own.id}`);
      check(
        "own-update",
        "the student CAN mark their own notification read (legitimate path)",
        after?.is_read === true,
        `PATCH ${status}; is_read is now ${after?.is_read}`,
      );
    }
  });

  const cleanup = lifecycle.cleanupResult ?? { ok: false, detail: "cleanup did not run" };

  console.log("\n=== user_notifications RLS ===");
  let failed = 0;
  for (const r of results) {
    if (!r.pass) failed += 1;
    console.log(`[${r.pass ? "PASS" : "FAIL"}] ${r.id}\n        ${r.property}\n        ${r.detail}`);
  }
  console.log(`\n${results.length} checks, ${failed} FAILED.`);
  console.log(cleanup.ok ? "Cleanup verified clean." : `Cleanup NOT clean: ${cleanup.detail}`);
  if (bodyError) console.error(`\nAborted: ${bodyError.message}`);

  // A run that aborted before provisioning finished must never read as success.
  const ranEverything = results.length === EXPECTED_CHECKS;
  if (!ranEverything) console.error(`Only ${results.length} of ${EXPECTED_CHECKS} checks ran.`);

  process.exit(failed === 0 && cleanup.ok && !bodyError && ranEverything ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
