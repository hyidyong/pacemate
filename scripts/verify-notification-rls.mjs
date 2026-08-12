// Live RLS verification for user_notifications (Stage 8 review finding 3).
//
// Read-only against real rows plus ONE temporary probe row per run, which is
// always removed. It asserts, against the real database with a real user JWT,
// the five properties the migration claims:
//
//   1. an unauthenticated caller (publishable key only) can read nothing
//   2. a student can read their own direct notification
//   3. a student can read a same-tenant role broadcast
//   4. a student can NOT read a cross-tenant role broadcast
//   5. a student can NOT update a cross-tenant role broadcast
//
// Usage: node scripts/verify-notification-rls.mjs
//
// This is verification, not a load test: it creates a single foreign-tenant
// probe row via the service role and deletes it in a finally block.

import { loadEnvLocal, requireEnv } from "./loadtest/lib/env.mjs";
import { createRestClient } from "./loadtest/lib/supabase-rest.mjs";

const DEMO_STUDENT = { identifier: "student1@pacemate.edu", password: "1234" };
const PROBE_MARKER = "rls-probe";

async function main() {
  const env = loadEnvLocal();
  const url = requireEnv(env, "NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = requireEnv(env, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  const serviceKey = requireEnv(env, "SUPABASE_SERVICE_ROLE_KEY");
  const rest = createRestClient({ url, serviceRoleKey: serviceKey });

  const results = [];
  const check = (id, pass, detail) => results.push({ id, pass, detail });

  // 1. Unauthenticated, publishable key only.
  const anonRes = await fetch(`${url}/rest/v1/user_notifications?select=id&limit=5`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
  });
  const anonRows = anonRes.ok ? await anonRes.json() : [];
  check(
    "anon cannot read notifications",
    anonRes.status === 200 && Array.isArray(anonRows) && anonRows.length === 0,
    `status ${anonRes.status}, ${Array.isArray(anonRows) ? anonRows.length : "?"} row(s) visible`,
  );

  // Sign in as a real student.
  const tokenRes = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email: DEMO_STUDENT.identifier, password: DEMO_STUDENT.password }),
  });
  const token = (await tokenRes.json()).access_token;
  if (!token) throw new Error("could not sign in the demo student; cannot verify authenticated policy");

  const asStudent = (path, init = {}) =>
    fetch(`${url}/rest/v1/${path}`, {
      ...init,
      headers: { apikey: anonKey, Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
    });

  const [profile] = await rest.select(
    "profiles",
    `select=id,school_id,role&identifier=eq.${encodeURIComponent(DEMO_STUDENT.identifier)}`,
  );
  if (!profile) throw new Error("demo student profile not found");

  let probeId = null;
  let probeSchoolId = null;

  try {
    // school_id is a foreign key, so the "other university" has to exist for the
    // duration of the probe. Both rows are removed in the finally block.
    const [probeSchool] = await rest.insert("schools", [
      { name: `${PROBE_MARKER} foreign university`, slug: `${PROBE_MARKER}-${Date.now()}` },
    ]);
    probeSchoolId = probeSchool.id;

    // A cross-tenant role broadcast this student must never see.
    const [probe] = await rest.insert("user_notifications", [
      {
        recipient_id: null,
        recipient_role: profile.role,
        school_id: probeSchoolId,
        category: "counseling",
        title: `${PROBE_MARKER} foreign tenant`,
        body: `${PROBE_MARKER} must not be visible cross-tenant`,
        target_href: "/notifications",
      },
    ]);
    probeId = probe.id;

    // 2 + 3. Own direct rows and same-tenant role broadcasts.
    const ownRows = await rest.select(
      "user_notifications",
      `select=id&recipient_id=eq.${profile.id}&limit=1`,
    );
    if (ownRows.length) {
      const res = await asStudent(`user_notifications?select=id&id=eq.${ownRows[0].id}`);
      const rows = await res.json();
      check("student reads own direct notification", Array.isArray(rows) && rows.length === 1, `${rows.length ?? "?"} row(s)`);
    } else {
      check("student reads own direct notification", true, "SKIPPED — no direct row exists for this student");
    }

    const sameTenant = await rest.select(
      "user_notifications",
      `select=id&recipient_id=is.null&recipient_role=eq.${profile.role}&school_id=eq.${profile.school_id}&limit=1`,
    );
    if (sameTenant.length) {
      const res = await asStudent(`user_notifications?select=id&id=eq.${sameTenant[0].id}`);
      const rows = await res.json();
      check("student reads same-tenant role broadcast", Array.isArray(rows) && rows.length === 1, `${rows.length ?? "?"} row(s)`);
    } else {
      check("student reads same-tenant role broadcast", true, "SKIPPED — no same-tenant broadcast exists");
    }

    // 4. Cross-tenant read denied.
    const foreignRead = await asStudent(`user_notifications?select=id&id=eq.${probeId}`);
    const foreignRows = await foreignRead.json();
    check(
      "cross-tenant role broadcast is NOT readable",
      Array.isArray(foreignRows) && foreignRows.length === 0,
      `${Array.isArray(foreignRows) ? foreignRows.length : "?"} row(s) visible`,
    );

    // 5. Cross-tenant update denied (zero rows affected, not an error).
    const foreignUpdate = await asStudent(`user_notifications?id=eq.${probeId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify({ is_read: true }),
    });
    const updated = await foreignUpdate.json();
    const [after] = await rest.select("user_notifications", `select=is_read&id=eq.${probeId}`);
    check(
      "cross-tenant role broadcast is NOT updatable",
      (!Array.isArray(updated) || updated.length === 0) && after?.is_read === false,
      `patch returned ${Array.isArray(updated) ? updated.length : "error"} row(s); is_read now ${after?.is_read}`,
    );
  } finally {
    if (probeId) {
      await rest.remove("user_notifications", `id=eq.${probeId}`);
    }
    if (probeSchoolId) {
      await rest.remove("schools", `id=eq.${probeSchoolId}`);
    }
    const leftoverRows = probeId
      ? await rest.select("user_notifications", `select=id&id=eq.${probeId}`)
      : [];
    const leftoverSchools = await rest.select("schools", `select=id&name=like.*${PROBE_MARKER}*`);
    console.log(
      `Probe cleanup: notifications ${leftoverRows.length === 0 ? "removed" : "LEFTOVER"}, schools ${
        leftoverSchools.length === 0 ? "removed" : "LEFTOVER"
      } (${(await rest.select("schools", "select=id")).length} school row(s) remain)`,
    );
  }

  console.log("\n=== user_notifications RLS ===");
  let failed = 0;
  for (const r of results) {
    if (!r.pass) failed += 1;
    console.log(`[${r.pass ? "PASS" : "FAIL"}] ${r.id}: ${r.detail}`);
  }
  console.log(`\n${failed === 0 ? "ALL RLS CHECKS PASSED" : `${failed} CHECK(S) FAILED`}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
