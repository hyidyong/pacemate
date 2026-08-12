// Stage 8 booking contention test — Stage 5 invariants under real concurrency.
//
// This is NOT an HTTP-200 test. Every scenario ends by reading the resulting
// business state straight from the database and asserting the Stage 5
// guarantees:
//
//   I1  capacity is never exceeded — at most ONE active (pending|approved)
//       request may exist for a given (professor, time range)
//   I2  duplicate submissions by the same student never create a second
//       logical reservation (D-013 idempotency)
//   I4  conflicts are reported as conflicts, never as storage failures or 5xx
//   I5  cancellation frees the slot and a re-book then succeeds exactly once
//
// Outcomes are derived from DATABASE STATE rather than response text: the
// progressive-enhancement encoding re-renders the page instead of returning the
// action's { ok, message }, and the Next-Action header encoding is rejected by
// this Next build when driven from outside the client runtime. Business state
// is the stronger evidence regardless — an HTTP 200 never proved a booking.
//
// SAFETY (review finding 4). This harness PROVISIONS auth users and profiles
// and issues real booking mutations, so it FAILS CLOSED: lib/safety.mjs must
// approve the target before anything is created. Cleanup is NOT a safety
// mechanism — it does nothing if the process is killed, if cleanup itself
// fails, or if the run was pointed at the wrong project. Rows are still
// marker-tagged and torn down, but that is hygiene, not protection.
//
// Required before any mutation:
//   PACEMATE_LOADTEST_ALLOW_MUTATIONS=1          deliberate destructive opt-in
//   PACEMATE_LOADTEST_EXPECTED_PROJECT_REF=<ref> must equal the configured project
//   and either PACEMATE_LOADTEST_TARGET_KIND=non-production
//          or PACEMATE_LOADTEST_SCHOOL_ID=<uuid> an explicitly isolated tenant
//
// Usage:
//   node scripts/loadtest/run-booking-contention.mjs --students=12
//   node scripts/loadtest/run-booking-contention.mjs --students=25 --out=docs/upgrade/stage-08/results/booking-contention.json

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { performance } from "node:perf_hooks";
import { loadEnvLocal, requireEnv } from "./lib/env.mjs";
import { createRestClient } from "./lib/supabase-rest.mjs";
import { loginVirtualUser } from "./lib/auth-session.mjs";
import { loadActionIds, invokeServerAction, bodyMentionsStorageFailure } from "./lib/server-action.mjs";
import { extractSlotIdsFromCounselingHtml, newRunId, LOADTEST_MARKER } from "./lib/fixtures.mjs";
import { summarize, formatSummary } from "./lib/stats.mjs";
import { assertSafeToMutate } from "./lib/safety.mjs";

const args = parseArgs(process.argv.slice(2));
const BASE_URL = args.baseUrl ?? "http://127.0.0.1:3000"; // loopback by default (finding 5)
const STUDENT_COUNT = Number(args.students ?? 12);
const PASSWORD = "loadtest-Aa1!-temporary";

async function main() {
  const env = loadEnvLocal();
  const supabaseUrl = requireEnv(env, "NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = requireEnv(env, "SUPABASE_SERVICE_ROLE_KEY");
  const rest = createRestClient({ url: supabaseUrl, serviceRoleKey });
  const actionIds = loadActionIds();
  const runId = newRunId();

  // Review finding 4: fail closed BEFORE anything is provisioned or booked.
  // Cleanup in the finally block is not protection — it does nothing if the
  // process is killed, if cleanup errors, or if the operator aimed this at the
  // wrong project.
  const guard = assertSafeToMutate(process.env, { supabaseUrl, baseUrl: BASE_URL });

  console.log(`Booking contention run ${runId} — ${STUDENT_COUNT} concurrent students`);
  console.log(
    `Target project ${guard.projectRef}` +
      (guard.declaredNonProduction ? " (declared non-production)" : "") +
      (guard.isolatedSchoolId ? ` (isolated tenant ${guard.isolatedSchoolId})` : ""),
  );
  const created = { authUserIds: [], profileIds: [] };
  const findings = [];

  try {
    // When an isolated tenant is named, use exactly that one — never "the first
    // school", which on a shared project is a real university.
    const school = guard.isolatedSchoolId
      ? (await rest.select("schools", `select=id,name&id=eq.${guard.isolatedSchoolId}`))[0]
      : (await rest.select("schools", "select=id,name&limit=1"))[0];
    if (!school) {
      throw new Error(
        `No schools row found for the configured tenant${guard.isolatedSchoolId ? ` (${guard.isolatedSchoolId})` : ""}.`,
      );
    }
    const students = await provisionStudents({
      rest,
      supabaseUrl,
      serviceRoleKey,
      runId,
      tenantId: school.id,
      count: STUDENT_COUNT,
      created,
    });
    console.log(`Provisioned ${students.length} students in tenant ${school.name}`);

    for (const student of students) {
      const login = await loginVirtualUser({
        baseUrl: BASE_URL,
        identifier: student.identifier,
        password: PASSWORD,
        actionIds,
      });
      student.cookie = login.ok ? login.jar.header() : null;
      if (!login.ok) console.log(`  login FAILED for ${student.identifier}: ${login.error}`);
    }
    const ready = students.filter((s) => s.cookie);
    if (ready.length < 2) throw new Error(`Only ${ready.length} students could log in — need >= 2`);
    console.log(`${ready.length}/${students.length} students logged in`);

    const slots = await discoverSlots(ready[0].cookie);
    if (slots.length < 2) throw new Error(`Need >= 2 bookable slots, found ${slots.length}`);
    console.log(`Discovered ${slots.length} bookable slots`);

    findings.push(await scenarioSameSlotStampede(ready, slots[0], rest, actionIds));
    findings.push(await scenarioDuplicateSubmissions(ready[0], slots[1], rest, actionIds));
    findings.push(await scenarioCancelRebook(ready, slots[1], rest, actionIds));
    findings.push(await scenarioDistinctSlots(ready, slots, rest, actionIds));
  } finally {
    const cleanup = await cleanupRun({ rest, supabaseUrl, serviceRoleKey, created, runId });
    console.log(`\nCleanup: ${JSON.stringify(cleanup)}`);
  }

  console.log("\n=== INVARIANT RESULTS ===");
  let failed = 0;
  for (const f of findings) {
    for (const check of f.checks) {
      const mark = check.pass ? "PASS" : "FAIL";
      if (!check.pass) failed += 1;
      console.log(`[${mark}] ${f.scenario} — ${check.id}: ${check.detail}`);
    }
  }

  if (args.out) {
    mkdirSync(dirname(args.out), { recursive: true });
    writeFileSync(
      args.out,
      JSON.stringify(
        { runId, baseUrl: BASE_URL, generatedAt: new Date().toISOString(), students: STUDENT_COUNT, findings },
        null,
        2,
      ),
    );
    console.log(`\nWrote ${args.out}`);
  }

  console.log(`\n${failed === 0 ? "ALL INVARIANTS HELD" : `${failed} INVARIANT CHECK(S) FAILED`}`);
  process.exit(failed === 0 ? 0 : 1);
}

// S1: N students submit the SAME slot simultaneously. Exactly one may win.
async function scenarioSameSlotStampede(students, slot, rest, actionIds) {
  console.log(`\n[S1] same-slot stampede — ${students.length} students, 1 slot`);
  const started = performance.now();
  const results = await Promise.all(
    students.map((student) =>
      timed(() =>
        invokeServerAction({
          baseUrl: BASE_URL,
          pagePath: "/counseling",
          actionId: actionIds.get("createCounselingRequest"),
          fields: { slotId: slot.id, topic: `${LOADTEST_MARKER} S1` },
          cookie: student.cookie,
        }),
      ),
    ),
  );
  const wallClockMs = performance.now() - started;

  const active = await activeRequestsForSlot(rest, slot);
  const winners = new Set(active.map((r) => r.student_id));
  const storageFailures = results.filter((r) => bodyMentionsStorageFailure(r.value.body)).length;
  const httpErrors = results.filter((r) => r.value.status >= 500).length;
  const summary = summarize(
    results.map((r) => ({ ok: r.value.ok, status: r.value.status, durationMs: r.durationMs })),
    wallClockMs,
  );
  const outcomes = { winners: winners.size, attempted: students.length, storageFailures, httpErrors };
  console.log(formatSummary("  latency", summary));
  console.log(`  outcomes ${JSON.stringify(outcomes)}  activeRowsForSlot=${active.length}`);

  return {
    scenario: "S1 same-slot stampede",
    concurrency: students.length,
    outcomes,
    latency: summary,
    checks: [
      {
        id: "I1 capacity never exceeded",
        pass: active.length <= 1,
        detail: `${active.length} active request(s) for the contended slot (must be <= 1)`,
      },
      {
        id: "I1b exactly one student owns the contended slot",
        pass: active.length === 1 && winners.size === 1,
        detail: `${winners.size} distinct student(s) own ${active.length} row(s) — must be 1 and 1`,
      },
      {
        id: "I4 conflicts are conflicts, not storage failures or 5xx",
        pass: storageFailures === 0 && httpErrors === 0,
        detail: `storage-failure responses=${storageFailures}, HTTP 5xx=${httpErrors}`,
      },
    ],
  };
}

// S2: one student double-submits the same slot. D-013 says the duplicate is
// acknowledged, not refused, and never creates a second row.
async function scenarioDuplicateSubmissions(student, slot, rest, actionIds) {
  console.log(`\n[S2] duplicate submissions — 1 student, 5 simultaneous submits of one slot`);
  const results = await Promise.all(
    Array.from({ length: 5 }, () =>
      timed(() =>
        invokeServerAction({
          baseUrl: BASE_URL,
          pagePath: "/counseling",
          actionId: actionIds.get("createCounselingRequest"),
          fields: { slotId: slot.id, topic: `${LOADTEST_MARKER} S2` },
          cookie: student.cookie,
        }),
      ),
    ),
  );

  const active = await activeRequestsForSlot(rest, slot);
  // Scoped to THIS slot on purpose: a student legitimately holds bookings for
  // other slots (nothing bounds that — KI-018 M10), so counting all their
  // active rows would flag correct behaviour.
  const studentRows = active.filter((row) => row.student_id === student.profileId);
  const outcomes = {
    activeRowsForSlot: active.length,
    studentRowsForSlot: studentRows.length,
    storageFailures: results.filter((r) => bodyMentionsStorageFailure(r.value.body)).length,
    httpErrors: results.filter((r) => r.value.status >= 500).length,
  };
  console.log(`  outcomes ${JSON.stringify(outcomes)}`);

  return {
    scenario: "S2 duplicate submissions",
    concurrency: 5,
    outcomes,
    checks: [
      {
        id: "I2 no duplicate logical reservation",
        pass: active.length === 1,
        detail: `${active.length} active row(s) for the slot after 5 duplicate submits (must be exactly 1)`,
      },
      {
        id: "I2b duplicates create no extra rows and no storage failure",
        pass: outcomes.storageFailures === 0 && outcomes.httpErrors === 0 && studentRows.length === 1,
        detail: `student holds ${studentRows.length} active row(s) for this slot; storage-failures=${outcomes.storageFailures}, 5xx=${outcomes.httpErrors}`,
      },
    ],
  };
}

// S3: cancel the held slot, then have everyone race to re-book it.
async function scenarioCancelRebook(students, slot, rest, actionIds) {
  console.log(`\n[S3] cancel then re-book race`);
  const active = await activeRequestsForSlot(rest, slot);
  if (!active.length) {
    return {
      scenario: "S3 cancel + re-book",
      checks: [{ id: "I5 setup", pass: false, detail: "no active row to cancel — S2 did not leave one" }],
    };
  }

  const owner = students.find((s) => s.profileId === active[0].student_id);
  await invokeServerAction({
    baseUrl: BASE_URL,
    pagePath: "/counseling",
    actionId: actionIds.get("cancelMyCounselingRequest"),
    fields: { requestId: active[0].id },
    cookie: owner.cookie,
  });

  const cancelledRow = (
    await rest.select("counseling_requests", `select=id,status&id=eq.${active[0].id}`)
  )[0];
  const cancelStatus = cancelledRow?.status ?? "missing";
  const afterCancel = await activeRequestsForSlot(rest, slot);
  console.log(`  cancel → row status=${cancelStatus}, activeRowsForSlot=${afterCancel.length}`);

  const results = await Promise.all(
    students.map((student) =>
      timed(() =>
        invokeServerAction({
          baseUrl: BASE_URL,
          pagePath: "/counseling",
          actionId: actionIds.get("createCounselingRequest"),
          fields: { slotId: slot.id, topic: `${LOADTEST_MARKER} S3` },
          cookie: student.cookie,
        }),
      ),
    ),
  );
  const afterRebook = await activeRequestsForSlot(rest, slot);
  const outcomes = {
    cancelStatus,
    activeRowsAfterRebook: afterRebook.length,
    storageFailures: results.filter((r) => bodyMentionsStorageFailure(r.value.body)).length,
    httpErrors: results.filter((r) => r.value.status >= 500).length,
  };
  console.log(`  re-book outcomes ${JSON.stringify(outcomes)}`);

  return {
    scenario: "S3 cancel + re-book",
    concurrency: students.length,
    outcomes,
    checks: [
      {
        id: "I5 cancellation frees the slot",
        pass: cancelStatus === "cancelled" && afterCancel.length === 0,
        detail: `cancelled row status=${cancelStatus}, active rows after cancel=${afterCancel.length} (must be 0)`,
      },
      {
        id: "I5b freed slot re-books exactly once under a race",
        pass: afterRebook.length === 1,
        detail: `${afterRebook.length} active row(s) after a ${students.length}-way re-book race (must be exactly 1)`,
      },
      {
        id: "I4 no storage failures or 5xx during the race",
        pass: outcomes.storageFailures === 0 && outcomes.httpErrors === 0,
        detail: `storage-failures=${outcomes.storageFailures}, 5xx=${outcomes.httpErrors}`,
      },
    ],
  };
}

// S4: students book DISTINCT slots concurrently — the protection must not
// serialize away legitimate throughput.
async function scenarioDistinctSlots(students, slots, rest, actionIds) {
  const pairs = students
    .map((student, i) => ({ student, slot: slots[i + 2] }))
    .filter((p) => p.slot);
  if (!pairs.length) {
    return { scenario: "S4 distinct slots", checks: [{ id: "setup", pass: false, detail: "no free slots" }] };
  }
  console.log(`\n[S4] distinct-slot concurrency — ${pairs.length} students, ${pairs.length} different slots`);

  const started = performance.now();
  const results = await Promise.all(
    pairs.map(({ student, slot }) =>
      timed(() =>
        invokeServerAction({
          baseUrl: BASE_URL,
          pagePath: "/counseling",
          actionId: actionIds.get("createCounselingRequest"),
          fields: { slotId: slot.id, topic: `${LOADTEST_MARKER} S4` },
          cookie: student.cookie,
        }),
      ),
    ),
  );
  const wallClockMs = performance.now() - started;
  const summary = summarize(
    results.map((r) => ({ ok: r.value.ok, status: r.value.status, durationMs: r.durationMs })),
    wallClockMs,
  );
  console.log(formatSummary("  latency", summary));

  const rowsPerSlot = [];
  for (const { slot } of pairs) {
    rowsPerSlot.push((await activeRequestsForSlot(rest, slot)).length);
  }
  const booked = rowsPerSlot.filter((n) => n === 1).length;
  const outcomes = {
    bookedSlots: booked,
    attempted: pairs.length,
    storageFailures: results.filter((r) => bodyMentionsStorageFailure(r.value.body)).length,
    httpErrors: results.filter((r) => r.value.status >= 500).length,
  };
  console.log(`  outcomes ${JSON.stringify(outcomes)}`);

  return {
    scenario: "S4 distinct slots",
    concurrency: pairs.length,
    outcomes,
    latency: summary,
    checks: [
      {
        id: "throughput preserved for non-contending bookings",
        pass: booked >= Math.ceil(pairs.length * 0.9),
        detail: `${booked}/${pairs.length} distinct-slot bookings succeeded`,
      },
      {
        id: "I1 one row per distinct slot",
        pass: rowsPerSlot.every((n) => n <= 1),
        detail: `rows per slot: ${JSON.stringify(rowsPerSlot)}`,
      },
    ],
  };
}

async function activeRequestsForSlot(rest, slot) {
  return rest.select(
    "counseling_requests",
    `select=id,student_id,status,requested_start,requested_end&professor_id=eq.${slot.professorId}` +
      `&requested_start=eq.${encodeURIComponent(new Date(slot.start).toISOString())}` +
      `&status=in.(pending,approved)`,
  );
}

async function discoverSlots(cookie) {
  const res = await fetch(`${BASE_URL}/counseling`, { headers: { cookie } });
  return extractSlotIdsFromCounselingHtml(await res.text());
}

async function provisionStudents({ rest, supabaseUrl, serviceRoleKey, runId, tenantId, count, created }) {
  const students = [];
  for (let i = 0; i < count; i += 1) {
    const identifier = `${LOADTEST_MARKER}+${runId}-${i}@loadtest.invalid`;

    const authRes = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email: identifier, password: PASSWORD, email_confirm: true }),
    });
    if (!authRes.ok) throw new Error(`admin createUser failed: ${authRes.status} ${await authRes.text()}`);
    const authUser = await authRes.json();
    created.authUserIds.push(authUser.id);

    const [profile] = await rest.insert("profiles", [
      {
        identifier,
        name: `부하테스트학생${i}`,
        role: "student",
        school_id: tenantId,
        auth_user_id: authUser.id,
      },
    ]);
    created.profileIds.push(profile.id);

    // Without is_onboarded the login action redirects to /onboarding.
    await rest.insert("student_profiles", [{ profile_id: profile.id, is_onboarded: true }]);

    students.push({ identifier, profileId: profile.id, authUserId: authUser.id });
  }
  return students;
}

async function cleanupRun({ rest, supabaseUrl, serviceRoleKey, created, runId }) {
  const report = { counselingRequests: 0, notifications: 0, studentProfiles: 0, profiles: 0, authUsers: 0 };
  if (created.profileIds.length) {
    const idList = `(${created.profileIds.join(",")})`;
    report.counselingRequests =
      (await rest.remove("counseling_requests", `student_id=in.${idList}`))?.length ?? 0;
    report.studentProfiles =
      (await rest.remove("student_profiles", `profile_id=in.${idList}`))?.length ?? 0;
  }
  report.notifications =
    (await rest.remove("user_notifications", `body=ilike.*${LOADTEST_MARKER}*`))?.length ?? 0;
  // Delete profiles by primary key. Matching on identifier would need the "+"
  // in the marker percent-encoded (a raw "+" in a query string decodes to a
  // space and silently matches nothing), and ids are unambiguous anyway.
  if (created.profileIds.length) {
    report.profiles =
      (await rest.remove("profiles", `id=in.(${created.profileIds.join(",")})`))?.length ?? 0;
  }

  for (const id of created.authUserIds) {
    const res = await fetch(`${supabaseUrl}/auth/v1/admin/users/${id}`, {
      method: "DELETE",
      headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` },
    });
    if (res.ok) report.authUsers += 1;
  }
  return report;
}

async function timed(fn) {
  const start = performance.now();
  const value = await fn();
  return { value, durationMs: performance.now() - start };
}

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    const match = /^--([^=]+)(?:=(.*))?$/.exec(arg);
    if (match) out[match[1]] = match[2] ?? true;
  }
  return out;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
