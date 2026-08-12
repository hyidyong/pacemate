// Stage 9 — direct Supabase/PostgREST attack surface probe.
//
// Frontend visibility is not an authorization boundary and neither is a server
// action: anything the browser's publishable key can reach, an attacker can
// reach with curl. This harness therefore ignores the application entirely and
// talks straight to PostgREST as three principals:
//
//   anon      — the publishable key, no session at all
//   user A    — a real signed-in student of probe tenant A
//   user B    — a real signed-in student of probe tenant B
//
// against two disposable tenants it provisions and removes itself. Every check
// states the property it is asserting, so a FAIL is a security finding and not a
// broken test.
//
// Usage:
//   PACEMATE_SECURITY_PROBE_ALLOW_WRITES=1 \
//   PACEMATE_SECURITY_PROBE_PROJECT_REF=<ref> \
//   node scripts/security/rls-probe.mjs [--json <path>]

import { writeFileSync } from "node:fs";
import { loadEnvLocal, requireEnv } from "../loadtest/lib/env.mjs";
import { createRestClient } from "../loadtest/lib/supabase-rest.mjs";
import { assertSafeToProbe } from "./lib/probe-guard.mjs";
import {
  PROBE_MARKER,
  provisionProbeTenants,
  signIn,
  teardownProbeTenants,
  verifyTornDown,
} from "./lib/probe-fixtures.mjs";

// Every table the app can reach. `expectAnonRead` records the DESIGN intent, so
// the probe reports "anon can read a table it should not" rather than merely
// dumping numbers.
const TABLES = [
  // [table, anon SELECT intended?, why]
  ["profiles", false, "names, login identifiers, roles and tenant of every user"],
  ["student_profiles", false, "grade, semester, career goal, interests"],
  ["student_courses", false, "who studies what"],
  ["student_mission_progress", false, "per-student weekly progress and free-text feedback"],
  ["student_weekly_progress", false, "per-student reflection, private notes"],
  ["student_course_progress", false, "per-student progress"],
  ["counseling_requests", false, "counseling topics — confidential"],
  ["user_notifications", false, "closed in Stage 8; regression guard"],
  ["chat_sessions", false, "AI tutor conversations"],
  ["chat_messages", false, "AI tutor conversation content"],
  ["escalations", false, "questions asked to professors"],
  ["posts", false, "community posts (authenticated-only by design)"],
  ["comments", false, "community comments"],
  ["post_reactions", false, "community reactions"],
  ["reports", false, "abuse reports"],
  ["professor_admin_tasks", false, "a professor's private task list"],
  ["study_roadmaps", false, "per-student roadmap"],
  ["study_tasks", false, "per-student tasks"],
  ["roadmap_requests", false, "per-student roadmap requests"],
  ["roadmap_results", false, "per-student roadmap results"],
  ["roadmap_revision_requests", false, "curriculum change workflow"],
  ["professor_question_auto_reply_rules", false, "a professor's automation rules"],
  ["syllabi", false, "course material — tenant-owned"],
  ["professor_teaching_slots", false, "tenant timetable data"],
  ["professor_availability", false, "counseling availability — tenant-owned"],
  ["course_professors", false, "tenant catalog mapping"],
  ["course_reviews", true, "public reviews — PUBLIC-BY-DESIGN"],
  ["faqs", true, "approved public FAQs — PUBLIC-BY-DESIGN"],
  ["notices", true, "public notices — PUBLIC-BY-DESIGN"],
  ["schools", true, "tenant directory needed before login — PUBLIC-BY-DESIGN"],
  ["departments", false, "tenant catalog"],
  ["courses", false, "tenant catalog"],
  ["professors", false, "professor directory incl. email and phone"],
];

function makeReporter() {
  const results = [];
  return {
    results,
    check(id, property, pass, detail) {
      results.push({ id, property, pass, detail });
    },
  };
}

async function rawFetch(url, path, headers, init = {}) {
  const res = await fetch(`${url}/rest/v1/${path}`, { ...init, headers });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

function rowCount(body) {
  return Array.isArray(body) ? body.length : null;
}

async function main() {
  const env = loadEnvLocal();
  const url = requireEnv(env, "NEXT_PUBLIC_SUPABASE_URL").replace(/\/$/, "");
  const anonKey = requireEnv(env, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  const serviceKey = requireEnv(env, "SUPABASE_SERVICE_ROLE_KEY");

  assertSafeToProbe({ ...env, ...process.env }, url);

  const rest = createRestClient({ url, serviceRoleKey: serviceKey });
  const { check, results } = makeReporter();

  const anonHeaders = { apikey: anonKey, Authorization: `Bearer ${anonKey}`, "Content-Type": "application/json" };
  const asAnon = (path, init) => rawFetch(url, path, anonHeaders, init);

  console.log(`Provisioning two disposable probe tenants (marker "${PROBE_MARKER}")…`);
  const fixtures = await provisionProbeTenants({ rest, url, serviceRoleKey: serviceKey });
  const A = fixtures.tenants.A;
  const B = fixtures.tenants.B;

  try {
    const tokenA = await signIn({ url, anonKey, email: A.email });
    const tokenB = await signIn({ url, anonKey, email: B.email });
    const headersFor = (token) => ({
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    });
    const asA = (path, init) => rawFetch(url, path, headersFor(tokenA), init);
    const asB = (path, init) => rawFetch(url, path, headersFor(tokenB), init);

    // ---------------------------------------------------------------- anon read
    for (const [table, anonReadIntended, why] of TABLES) {
      const { status, body } = await asAnon(`${table}?select=*&limit=3`);
      const count = rowCount(body);
      const readable = status === 200 && (count ?? 0) > 0;
      const total = await rest
        .select(table, "select=id&limit=1")
        .then((rows) => rows.length)
        .catch(() => 0);

      if (anonReadIntended) {
        check(
          `anon-read:${table}`,
          `anon MAY read ${table} (${why})`,
          true,
          `status ${status}, ${count ?? "?"} row(s) — public by design`,
        );
      } else if (total === 0) {
        check(
          `anon-read:${table}`,
          `anon must NOT read ${table} (${why})`,
          !readable,
          `status ${status}, ${count ?? "?"} row(s) — table is EMPTY, absence of rows is not proof of denial`,
        );
      } else {
        check(
          `anon-read:${table}`,
          `anon must NOT read ${table} (${why})`,
          !readable,
          `status ${status}, ${count ?? "?"} row(s) visible with the publishable key alone`,
        );
      }
    }

    // --------------------------------------------------------------- anon write
    // Every target below is a row this run created inside a probe tenant.
    const anonWrites = [
      {
        id: "anon-write:profiles.role",
        property: "anon must NOT be able to change a profile (role / tenant / auth binding)",
        run: async () => {
          const res = await asAnon(`profiles?id=eq.${A.profile.id}`, {
            method: "PATCH",
            headers: { ...anonHeaders, Prefer: "return=representation" },
            body: JSON.stringify({ name: `${PROBE_MARKER} OVERWRITTEN` }),
          });
          const [after] = await rest.select("profiles", `select=name&id=eq.${A.profile.id}`);
          return {
            pass: after?.name !== `${PROBE_MARKER} OVERWRITTEN`,
            detail: `PATCH ${res.status}; name is now "${after?.name}"`,
          };
        },
      },
      {
        id: "anon-write:profiles.insert",
        property: "anon must NOT be able to create a profile",
        run: async () => {
          const identifier = `${PROBE_MARKER}-anon-insert-${fixtures.runId}@probe.invalid`;
          const res = await asAnon(`profiles`, {
            method: "POST",
            headers: { ...anonHeaders, Prefer: "return=representation" },
            body: JSON.stringify({
              identifier,
              name: `${PROBE_MARKER} anon inserted`,
              role: "admin",
              school_id: A.school.id,
            }),
          });
          const rows = await rest.select("profiles", `select=id&identifier=eq.${encodeURIComponent(identifier)}`);
          if (rows.length) await rest.remove("profiles", `identifier=eq.${encodeURIComponent(identifier)}`);
          return { pass: rows.length === 0, detail: `POST ${res.status}; ${rows.length} row(s) created (role=admin attempted)` };
        },
      },
      {
        id: "anon-write:professor_availability.toggle",
        property: "anon must NOT be able to change counseling availability",
        run: async () => {
          const res = await asAnon(`professor_availability?id=eq.${A.availability.id}`, {
            method: "PATCH",
            headers: { ...anonHeaders, Prefer: "return=representation" },
            body: JSON.stringify({ is_active: false }),
          });
          const [after] = await rest.select("professor_availability", `select=is_active&id=eq.${A.availability.id}`);
          if (after?.is_active === false) {
            await rest.update("professor_availability", `id=eq.${A.availability.id}`, { is_active: true });
          }
          return { pass: after?.is_active !== false, detail: `PATCH ${res.status}; is_active is now ${after?.is_active}` };
        },
      },
      {
        id: "anon-write:professor_availability.insert",
        property: "anon must NOT be able to fabricate bookable counseling slots",
        run: async () => {
          const res = await asAnon(`professor_availability`, {
            method: "POST",
            headers: { ...anonHeaders, Prefer: "return=representation" },
            body: JSON.stringify({
              professor_id: A.professor.id,
              day_of_week: 3,
              start_time: "23:00:00",
              end_time: "23:30:00",
              slot_minutes: 30,
              is_active: true,
            }),
          });
          const rows = await rest.select(
            "professor_availability",
            `select=id&professor_id=eq.${A.professor.id}&start_time=eq.23:00:00`,
          );
          if (rows.length) {
            await rest.remove("professor_availability", `id=in.(${rows.map((r) => r.id).join(",")})`);
          }
          return { pass: rows.length === 0, detail: `POST ${res.status}; ${rows.length} fabricated slot(s)` };
        },
      },
      {
        id: "anon-write:user_notifications.insert",
        property: "anon must NOT be able to address a notification to an arbitrary user",
        run: async () => {
          const title = `${PROBE_MARKER} anon spoofed`;
          const res = await asAnon(`user_notifications`, {
            method: "POST",
            headers: { ...anonHeaders, Prefer: "return=representation" },
            body: JSON.stringify({
              recipient_id: A.profile.id,
              recipient_role: null,
              school_id: A.school.id,
              category: "system",
              title,
              body: `${PROBE_MARKER} spoofed body`,
              target_href: "/admin",
            }),
          });
          const rows = await rest.select("user_notifications", `select=id&title=eq.${encodeURIComponent(title)}`);
          if (rows.length) await rest.remove("user_notifications", `title=eq.${encodeURIComponent(title)}`);
          return { pass: rows.length === 0, detail: `POST ${res.status}; ${rows.length} spoofed notification(s) delivered` };
        },
      },
      {
        id: "anon-write:student_mission_progress",
        property: "anon must NOT be able to rewrite a student's progress",
        run: async () => {
          const res = await asAnon(`student_mission_progress?id=eq.${A.mission.id}`, {
            method: "PATCH",
            headers: { ...anonHeaders, Prefer: "return=representation" },
            body: JSON.stringify({ is_completed: true }),
          });
          const [after] = await rest.select("student_mission_progress", `select=is_completed&id=eq.${A.mission.id}`);
          if (after?.is_completed) {
            await rest.update("student_mission_progress", `id=eq.${A.mission.id}`, { is_completed: false });
          }
          return { pass: after?.is_completed !== true, detail: `PATCH ${res.status}; is_completed is now ${after?.is_completed}` };
        },
      },
      {
        id: "anon-write:student_courses",
        property: "anon must NOT be able to change a student's enrolment",
        run: async () => {
          const res = await asAnon(`student_courses?id=eq.${A.enrolment.id}`, {
            method: "PATCH",
            headers: { ...anonHeaders, Prefer: "return=representation" },
            body: JSON.stringify({ current_week: 30 }),
          });
          const [after] = await rest.select("student_courses", `select=current_week&id=eq.${A.enrolment.id}`);
          if (after?.current_week === 30) {
            await rest.update("student_courses", `id=eq.${A.enrolment.id}`, { current_week: 1 });
          }
          return { pass: after?.current_week !== 30, detail: `PATCH ${res.status}; current_week is now ${after?.current_week}` };
        },
      },
      {
        id: "anon-write:student_profiles",
        property: "anon must NOT be able to change a student profile",
        run: async () => {
          const res = await asAnon(`student_profiles?id=eq.${A.studentProfile.id}`, {
            method: "PATCH",
            headers: { ...anonHeaders, Prefer: "return=representation" },
            body: JSON.stringify({ grade: 9 }),
          });
          const [after] = await rest.select("student_profiles", `select=grade&id=eq.${A.studentProfile.id}`);
          if (after?.grade === 9) {
            await rest.update("student_profiles", `id=eq.${A.studentProfile.id}`, { grade: 1 });
          }
          return { pass: after?.grade !== 9, detail: `PATCH ${res.status}; grade is now ${after?.grade}` };
        },
      },
    ];

    for (const probe of anonWrites) {
      const { pass, detail } = await probe.run();
      check(probe.id, probe.property, pass, detail);
    }

    // ------------------------------------------------------- cross-tenant reads
    const crossReads = [
      ["counseling_requests", `counseling_requests?select=id,topic&id=eq.${A.counseling.id}`, "B must not read A's counseling request"],
      ["profiles", `profiles?select=id,identifier&id=eq.${A.profile.id}`, "B must not read A's profile"],
      ["student_profiles", `student_profiles?select=id&id=eq.${A.studentProfile.id}`, "B must not read A's student profile"],
      ["student_courses", `student_courses?select=id&id=eq.${A.enrolment.id}`, "B must not read A's enrolment"],
      ["student_mission_progress", `student_mission_progress?select=id&id=eq.${A.mission.id}`, "B must not read A's progress"],
      ["user_notifications", `user_notifications?select=id&id=eq.${A.directNotification.id}`, "B must not read A's direct notification"],
      ["user_notifications(broadcast)", `user_notifications?select=id&id=eq.${A.broadcast.id}`, "B must not read A's tenant broadcast"],
      ["professor_admin_tasks", `professor_admin_tasks?select=id&limit=5`, "B must not read other tenants' professor task lists"],
      ["syllabi", `syllabi?select=id&limit=5`, "B must not read other tenants' syllabi"],
      ["courses", `courses?select=id&id=eq.${A.course.id}`, "B must not read A's catalog"],
      ["professors", `professors?select=id,email&id=eq.${A.professor.id}`, "B must not read A's professor directory"],
    ];
    for (const [label, path, property] of crossReads) {
      const { status, body } = await asB(path);
      const count = rowCount(body);
      check(`cross-read:${label}`, property, status === 200 && count === 0, `status ${status}, ${count ?? "?"} row(s)`);
    }

    // ------------------------------------------------------ cross-tenant writes
    const crossWrites = [
      {
        id: "cross-write:notification",
        property: "B must not mark A's notification read",
        run: async () => {
          const res = await asB(`user_notifications?id=eq.${A.directNotification.id}`, {
            method: "PATCH",
            headers: { ...headersFor(tokenB), Prefer: "return=representation" },
            body: JSON.stringify({ is_read: true }),
          });
          const [after] = await rest.select("user_notifications", `select=is_read&id=eq.${A.directNotification.id}`);
          if (after?.is_read) await rest.update("user_notifications", `id=eq.${A.directNotification.id}`, { is_read: false });
          return { pass: after?.is_read !== true, detail: `PATCH ${res.status}; is_read is now ${after?.is_read}` };
        },
      },
      {
        id: "cross-write:counseling",
        property: "B must not cancel A's counseling request",
        run: async () => {
          const res = await asB(`counseling_requests?id=eq.${A.counseling.id}`, {
            method: "PATCH",
            headers: { ...headersFor(tokenB), Prefer: "return=representation" },
            body: JSON.stringify({ status: "cancelled" }),
          });
          const [after] = await rest.select("counseling_requests", `select=status&id=eq.${A.counseling.id}`);
          if (after?.status !== "pending") {
            await rest.update("counseling_requests", `id=eq.${A.counseling.id}`, { status: "pending" });
          }
          return { pass: after?.status === "pending", detail: `PATCH ${res.status}; status is now ${after?.status}` };
        },
      },
      {
        id: "cross-write:availability",
        property: "B must not disable A's professor availability",
        run: async () => {
          const res = await asB(`professor_availability?id=eq.${A.availability.id}`, {
            method: "PATCH",
            headers: { ...headersFor(tokenB), Prefer: "return=representation" },
            body: JSON.stringify({ is_active: false }),
          });
          const [after] = await rest.select("professor_availability", `select=is_active&id=eq.${A.availability.id}`);
          if (after?.is_active === false) {
            await rest.update("professor_availability", `id=eq.${A.availability.id}`, { is_active: true });
          }
          return { pass: after?.is_active !== false, detail: `PATCH ${res.status}; is_active is now ${after?.is_active}` };
        },
      },
      {
        id: "cross-write:mission",
        property: "B must not rewrite A's mission progress",
        run: async () => {
          const res = await asB(`student_mission_progress?id=eq.${A.mission.id}`, {
            method: "PATCH",
            headers: { ...headersFor(tokenB), Prefer: "return=representation" },
            body: JSON.stringify({ is_completed: true }),
          });
          const [after] = await rest.select("student_mission_progress", `select=is_completed&id=eq.${A.mission.id}`);
          if (after?.is_completed) {
            await rest.update("student_mission_progress", `id=eq.${A.mission.id}`, { is_completed: false });
          }
          return { pass: after?.is_completed !== true, detail: `PATCH ${res.status}; is_completed is now ${after?.is_completed}` };
        },
      },
      {
        id: "cross-write:profile",
        property: "B must not edit A's profile",
        run: async () => {
          const res = await asB(`profiles?id=eq.${A.profile.id}`, {
            method: "PATCH",
            headers: { ...headersFor(tokenB), Prefer: "return=representation" },
            body: JSON.stringify({ name: `${PROBE_MARKER} B-OVERWROTE-A` }),
          });
          const [after] = await rest.select("profiles", `select=name&id=eq.${A.profile.id}`);
          if (after?.name === `${PROBE_MARKER} B-OVERWROTE-A`) {
            await rest.update("profiles", `id=eq.${A.profile.id}`, { name: `${PROBE_MARKER} student a` });
          }
          return {
            pass: after?.name !== `${PROBE_MARKER} B-OVERWROTE-A`,
            detail: `PATCH ${res.status}; name is now "${after?.name}"`,
          };
        },
      },
    ];
    for (const probe of crossWrites) {
      const { pass, detail } = await probe.run();
      check(probe.id, probe.property, pass, detail);
    }

    // ------------------------------------------------- legitimate paths (allow)
    // A security fix that denies everyone is not a fix. These must stay GREEN.
    const allowChecks = [
      {
        id: "allow:A-reads-own-notification",
        property: "A CAN read their own direct notification",
        path: `user_notifications?select=id&id=eq.${A.directNotification.id}`,
        expect: 1,
      },
      {
        id: "allow:A-reads-own-tenant-broadcast",
        property: "A CAN read their own tenant's role broadcast",
        path: `user_notifications?select=id&id=eq.${A.broadcast.id}`,
        expect: 1,
      },
      {
        id: "allow:A-reads-own-counseling",
        property: "A CAN read their own counseling request",
        path: `counseling_requests?select=id&id=eq.${A.counseling.id}`,
        expect: 1,
      },
      {
        id: "allow:A-reads-own-profile",
        property: "A CAN read their own profile",
        path: `profiles?select=id&id=eq.${A.profile.id}`,
        expect: 1,
      },
      {
        id: "allow:A-reads-own-student-profile",
        property: "A CAN read their own student profile",
        path: `student_profiles?select=id&id=eq.${A.studentProfile.id}`,
        expect: 1,
      },
      {
        id: "allow:A-reads-own-enrolment",
        property: "A CAN read their own enrolment",
        path: `student_courses?select=id&id=eq.${A.enrolment.id}`,
        expect: 1,
      },
      {
        id: "allow:A-reads-own-tenant-courses",
        property: "A CAN read their own tenant's catalog",
        path: `courses?select=id&id=eq.${A.course.id}`,
        expect: 1,
      },
      {
        id: "allow:A-reads-own-tenant-professors",
        property: "A CAN read their own tenant's professor directory",
        path: `professors?select=id&id=eq.${A.professor.id}`,
        expect: 1,
      },
      {
        id: "allow:A-reads-own-tenant-availability",
        property: "A CAN read their own tenant's counseling availability",
        path: `professor_availability?select=id&id=eq.${A.availability.id}`,
        expect: 1,
      },
    ];
    for (const c of allowChecks) {
      const { status, body } = await asA(c.path);
      const count = rowCount(body);
      check(c.id, c.property, status === 200 && count === c.expect, `status ${status}, ${count ?? "?"} row(s)`);
    }

    // A must be able to mark their OWN notification read.
    {
      const res = await asA(`user_notifications?id=eq.${A.directNotification.id}`, {
        method: "PATCH",
        headers: { ...headersFor(tokenA), Prefer: "return=representation" },
        body: JSON.stringify({ is_read: true }),
      });
      const [after] = await rest.select("user_notifications", `select=is_read&id=eq.${A.directNotification.id}`);
      check(
        "allow:A-marks-own-notification-read",
        "A CAN mark their own notification read",
        after?.is_read === true,
        `PATCH ${res.status}; is_read is now ${after?.is_read}`,
      );
    }
  } finally {
    await teardownProbeTenants({ rest, fixtures });
    const leftovers = await verifyTornDown({ rest });
    console.log(
      leftovers.length
        ? `\n!! TEARDOWN LEFTOVERS: ${leftovers.join(", ")}`
        : "\nTeardown verified: 0 probe rows remain.",
    );
  }

  console.log("\n=== Stage 9 direct Data API probe ===\n");
  let failed = 0;
  for (const r of results) {
    if (!r.pass) failed += 1;
    console.log(`[${r.pass ? "PASS" : "FAIL"}] ${r.id}\n        ${r.property}\n        ${r.detail}`);
  }
  console.log(`\n${results.length} checks, ${failed} FAILED (each failure is a security finding).`);

  const jsonFlag = process.argv.indexOf("--json");
  if (jsonFlag !== -1 && process.argv[jsonFlag + 1]) {
    writeFileSync(process.argv[jsonFlag + 1], JSON.stringify({ results }, null, 2));
  }

  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
