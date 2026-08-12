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
// Every row this creates is removed, and the run fails if anything is left.
//
// Usage:
//   PACEMATE_SECURITY_PROBE_ALLOW_WRITES=1 \
//   PACEMATE_SECURITY_PROBE_PROJECT_REF=<ref> \
//   node scripts/security/audit-trail-probe.mjs

import { loadEnvLocal, requireEnv } from "../loadtest/lib/env.mjs";
import { assertSafeToProbe } from "./lib/probe-guard.mjs";
import { createProbeRest } from "./lib/probe-rest.mjs";

const MARKER = "stage9-audit-probe";

async function main() {
  const env = loadEnvLocal();
  const url = requireEnv(env, "NEXT_PUBLIC_SUPABASE_URL").replace(/\/$/, "");
  const anonKey = requireEnv(env, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  const serviceKey = requireEnv(env, "SUPABASE_SERVICE_ROLE_KEY");

  assertSafeToProbe({ ...env, ...process.env }, url);

  const rest = createProbeRest({ url, serviceRoleKey: serviceKey });
  const anonHeaders = { apikey: anonKey, Authorization: `Bearer ${anonKey}`, "Content-Type": "application/json" };
  const asAnon = (path, init = {}) =>
    fetch(`${url}/rest/v1/${path}`, { ...init, headers: { ...anonHeaders, ...(init.headers ?? {}) } });

  const results = [];
  const check = (id, property, pass, detail) => results.push({ id, property, pass, detail });

  const created = { events: [], profiles: [] };

  try {
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
    const anonRows = res.ok ? await res.json() : [];
    check("f7:anon-cannot-read", "anon CANNOT read the audit trail", !res.ok || anonRows.length === 0, `status ${res.status}`);

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
        identifier: `${MARKER}-actor@probe.invalid`,
        name: `${MARKER} disposable actor`,
        role: "student",
        school_id: school.id,
      },
    ]);
    created.profiles.push(disposable.id);

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
      created.profiles = created.profiles.filter((id) => id !== disposable.id);
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
  } finally {
    for (const id of created.events) {
      await rest.remove("security_events", `id=eq.${id}`).catch(() => {});
    }
    for (const id of created.profiles) {
      await rest.remove("profiles", `id=eq.${id}`).catch(() => {});
    }
  }

  const leftoverEvents = await rest.select("security_events", `select=id&event=like.${MARKER}*`).catch(() => null);
  const leftoverProfiles = await rest
    .select("profiles", `select=id&identifier=like.*${MARKER}*`)
    .catch(() => null);
  const clean = leftoverEvents?.length === 0 && leftoverProfiles?.length === 0;
  check(
    "cleanup",
    "the probe leaves nothing behind and can prove it",
    clean,
    leftoverEvents === null || leftoverProfiles === null
      ? "UNVERIFIABLE — residue read failed"
      : `${leftoverEvents.length} event(s), ${leftoverProfiles.length} profile(s)`,
  );

  console.log("\n=== Stage 9 durable audit trail probe ===\n");
  let failed = 0;
  for (const r of results) {
    if (!r.pass) failed += 1;
    console.log(`[${r.pass ? "PASS" : "FAIL"}] ${r.id}\n        ${r.property}\n        ${r.detail}`);
  }
  console.log(`\n${results.length} checks, ${failed} FAILED.`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
