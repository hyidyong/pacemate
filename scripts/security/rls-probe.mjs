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
import { assertSafeToProbe } from "./lib/probe-guard.mjs";
import { createProbeAuthAdmin, createProbeRest, signInFactory } from "./lib/probe-rest.mjs";
import { createRoleClient } from "./lib/probe-http.mjs";
import { createProbeLifecycle, EXIT } from "./lib/probe-lifecycle.mjs";
import { ProbeLedger, sweepOrphans, verifyNoResidue } from "./lib/probe-ledger.mjs";
import { PROBE_MARKER, PROBE_PASSWORD, provisionProbeTenants } from "./lib/probe-fixtures.mjs";

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

const PROBE_TIMEOUT_MS = Number(process.env.PACEMATE_SECURITY_PROBE_TIMEOUT_MS ?? 15000);

function makeReporter() {
  const results = [];
  return {
    results,
    check(id, property, pass, detail) {
      results.push({ id, property, pass, detail });
    },
  };
}

// Codex round 3, F1: the role probes used bare `fetch` with NO timeout at all.
// They now share the one bounded transport, whose deadline covers body
// consumption as well as headers.
function makeRawFetch(url, timeoutMs) {
  return (baseHeaders) => createRoleClient({ url, baseHeaders, timeoutMs });
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

  // Bounded timeouts everywhere: a hung request during CLEANUP is the one hang
  // that must never be indefinite, because it leaves fixtures alive.
  const rest = createProbeRest({ url, serviceRoleKey: serviceKey });
  const auth = createProbeAuthAdmin({ url, serviceRoleKey: serviceKey });
  const signIn = signInFactory({ url, anonKey });

  // Operator-run recovery for the case `finally` cannot cover (SIGKILL, crash).
  if (process.argv.includes("--sweep")) {
    const { removed, failures } = await sweepOrphans({ rest, auth });
    console.log(removed.length ? `Swept: ${removed.join(", ")}` : "Nothing to sweep.");
    const residue = await verifyNoResidue({ rest, auth });
    if (failures.length || !residue.clean) {
      console.error(`Sweep incomplete. failures=${JSON.stringify(failures)} residue=${JSON.stringify(residue)}`);
      process.exit(1);
    }
    console.log("Sweep verified clean.");
    process.exit(0);
  }

  const { check, results } = makeReporter();

  const anonHeaders = { apikey: anonKey, Authorization: `Bearer ${anonKey}`, "Content-Type": "application/json" };
  const roleClient = makeRawFetch(url, PROBE_TIMEOUT_MS);
  const asAnon = roleClient(anonHeaders);

  // Codex finding 1: the ledger belongs to the CALLER and provisioning happens
  // INSIDE the try, so a partial provision — or a provisioner that never
  // returns — is still fully cleaned up by the finally below.
  const ledger = new ProbeLedger({ rest, auth });
  let cleanupFailures = [];
  let residue = { residue: [], unverifiable: ["cleanup did not run"], clean: false };

  // Codex round 3, F1: cleanup must also run on Ctrl-C and on `kill`, exactly
  // once, and the process must not exit before it finishes.
  const lifecycle = createProbeLifecycle({
    timeoutMs: Number(process.env.PACEMATE_SECURITY_PROBE_CLEANUP_TIMEOUT_MS ?? 30000),
    cleanup: async () => {
      cleanupFailures = await ledger.cleanup();
      residue = await verifyNoResidue({ rest, auth });
      const ok = cleanupFailures.length === 0 && residue.clean;
      if (!ok) {
        for (const failure of cleanupFailures) {
          console.error(`[CLEANUP FAILED] ${failure.table} ${failure.id} (${failure.label}): ${failure.message}`);
        }
        for (const entry of residue.residue) console.error(`[RESIDUE] ${entry}`);
        for (const entry of residue.unverifiable) console.error(`[UNVERIFIABLE] ${entry}`);
        console.error("Run `node scripts/security/rls-probe.mjs --sweep` to remove marked residue.");
      }
      return { ok, detail: ok ? "clean" : "residue or cleanup failure" };
    },
  });

  const { bodyError: provisionOrProbeError } = await lifecycle.run(async () => {
    console.log(`Provisioning two disposable probe tenants (marker "${PROBE_MARKER}")…`);
    const fixtures = await provisionProbeTenants(ledger);
    const A = fixtures.tenants.A;
    const B = fixtures.tenants.B;

    const tokenA = await signIn(A.email, PROBE_PASSWORD);
    const tokenB = await signIn(B.email, PROBE_PASSWORD);
    const tokenProfA = await signIn(A.professorEmail, PROBE_PASSWORD);
    const headersFor = (token) => ({
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    });
    const asA = roleClient(headersFor(tokenA));
    const asB = roleClient(headersFor(tokenB));
    const asProfA = roleClient(headersFor(tokenProfA));

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

    // ------------------------------- cross-tenant WRITE primitives (Codex F2)
    // A caller-owned row that REFERENCES a tenant resource is a write primitive:
    // the row itself passes an ownership check, and the foreign reference then
    // satisfies relationship-based RLS downstream. The app-layer tenant gate is
    // irrelevant here — these go straight to PostgREST.
    //
    // Any row that unexpectedly succeeds is recorded in the ledger immediately,
    // so a security failure still cleans up.
    const tag = (suffix) => `${PROBE_MARKER}-${suffix}`;

    // Outcome is read back with the SERVICE ROLE, never inferred from the
    // response body. PostgREST answers 201 with an empty body when the client
    // does not ask for a representation, and an earlier version of this probe
    // read that as "denied" — reporting safety it had not observed, while the
    // rows really existed. State is the evidence; the status code is a hint.
    const confirmWrite = async (probe) => {
      // Deliberately NO `Prefer: return=representation`. Asking for one makes
      // PostgREST re-check the inserted row against the SELECT policy and roll
      // back on failure, which produced 403s that looked like protection but
      // vanish the moment an attacker omits the header. This is the weakest
      // attacker path, so it is the one worth testing.
      const res = await asA(probe.table, {
        method: "POST",
        headers: headersFor(tokenA),
        body: JSON.stringify(probe.row),
      });
      const rows = await rest
        .select(probe.table, `select=id&${probe.findColumn}=eq.${encodeURIComponent(probe.findValue)}`)
        .catch(() => null);
      if (rows === null) {
        return { status: res.status, count: null, detail: "read-back FAILED — cannot verify" };
      }
      for (const row of rows) ledger.recordRow(probe.table, row.id, probe.id);
      return { status: res.status, count: rows.length, detail: `${rows.length} row(s) in the database` };
    };

    // The same writes, same-tenant, must still work. A tenant-consistency rule
    // that blocks legitimate enrolment is not a fix.
    const sameTenantWrites = [
      {
        id: "allow:A-progress-own-course",
        property: "A CAN create progress against their own tenant's course",
        table: "student_mission_progress",
        findColumn: "actual_progress_feedback",
        findValue: tag("st-mission"),
        row: {
          student_id: A.profile.id,
          course_id: A.course.id,
          week_number: 3,
          is_completed: false,
          actual_progress_feedback: tag("st-mission"),
        },
      },
      {
        id: "allow:A-roadmap-own-course",
        property: "A CAN create a study roadmap for their own tenant's course",
        table: "study_roadmaps",
        findColumn: "title",
        findValue: tag("st-roadmap"),
        row: { student_id: A.profile.id, course_id: A.course.id, title: tag("st-roadmap") },
      },
      {
        id: "allow:A-post-own-tenant",
        property: "A CAN publish a post in their own tenant",
        table: "posts",
        findColumn: "title",
        findValue: tag("st-post"),
        row: {
          author_id: A.profile.id,
          school_id: A.school.id,
          community_type: "student",
          category: "free",
          title: tag("st-post"),
          content: tag("st-post-body"),
          status: "active",
        },
      },
      {
        id: "allow:A-review-own-course",
        property: "A CAN review their own tenant's course",
        table: "course_reviews",
        findColumn: "content",
        findValue: tag("st-review"),
        row: { author_id: A.profile.id, course_id: A.course.id, content: tag("st-review") },
      },
    ];

    for (const probe of sameTenantWrites) {
      const { status, count, detail } = await confirmWrite(probe);
      check(probe.id, probe.property, count === 1, `POST ${status}; ${detail}`);
    }

    // The cross-tenant study task needs a valid OWN parent roadmap, because
    // study_tasks.roadmap_id is NOT NULL — otherwise the insert fails on the
    // schema before RLS is ever consulted, and a 400 reads as a denial.
    const ownRoadmap = await rest
      .select("study_roadmaps", `select=id&title=eq.${encodeURIComponent(tag("st-roadmap"))}`)
      .catch(() => []);
    const ownRoadmapId = ownRoadmap[0]?.id ?? null;

    const tenantWrites = [
      {
        id: "cross-write:enrolment-foreign-course",
        property: "A must not enrol in tenant B's course",
        table: "student_courses",
        findColumn: "source_text",
        findValue: tag("xt-enrol"),
        row: {
          student_id: A.profile.id,
          course_id: B.course.id,
          status: "interested",
          semester_label: "2026-2",
          source_text: tag("xt-enrol"),
        },
      },
      {
        id: "cross-write:mission-foreign-course",
        property: "A must not create progress against tenant B's course",
        table: "student_mission_progress",
        findColumn: "actual_progress_feedback",
        findValue: tag("xt-mission"),
        row: {
          student_id: A.profile.id,
          course_id: B.course.id,
          week_number: 2,
          is_completed: false,
          actual_progress_feedback: tag("xt-mission"),
        },
      },
      {
        id: "cross-write:roadmap-foreign-course",
        property: "A must not create a study roadmap against tenant B's course",
        table: "study_roadmaps",
        findColumn: "title",
        findValue: tag("xt-roadmap"),
        row: { student_id: A.profile.id, course_id: B.course.id, title: tag("xt-roadmap") },
      },
      {
        id: "cross-write:task-foreign-course",
        property: "A must not create a study task against tenant B's course",
        table: "study_tasks",
        findColumn: "title",
        findValue: tag("xt-task"),
        skipWhen: () => !ownRoadmapId,
        row: {
          student_id: A.profile.id,
          roadmap_id: ownRoadmapId,
          course_id: B.course.id,
          title: tag("xt-task"),
        },
      },
      {
        id: "cross-write:post-foreign-tenant",
        property: "A must not publish a post into tenant B",
        table: "posts",
        findColumn: "title",
        findValue: tag("xt-post"),
        row: {
          author_id: A.profile.id,
          school_id: B.school.id,
          community_type: "student",
          category: "free",
          title: tag("xt-post"),
          content: tag("xt-post-body"),
          status: "active",
        },
      },
      {
        id: "cross-write:review-foreign-course",
        property: "A must not review tenant B's course",
        table: "course_reviews",
        findColumn: "content",
        findValue: tag("xt-review"),
        row: { author_id: A.profile.id, course_id: B.course.id, content: tag("xt-review") },
      },
    ];

    for (const probe of tenantWrites) {
      if (probe.skipWhen?.()) {
        check(probe.id, probe.property, false, "PREREQUISITE MISSING — check could not run");
        continue;
      }
      const { status, count, detail } = await confirmWrite(probe);
      check(probe.id, probe.property, count === 0, `POST ${status}; ${detail}`);
    }

    // ---------------------- Stage 5 counseling invariants at the DB (Codex F3)
    // The professor's UPDATE policy authorized by ownership only, so a professor
    // could PATCH their own counseling rows directly and bypass everything
    // Stage 5 built: the legal-transition compare-and-set, the notification
    // fan-out, timing validation, and the student-side invariants. Ownership is
    // not the same question as "is this a legal change".
    const counselingWrites = [
      {
        id: "counseling-direct:status",
        property: "a professor must not drive a status transition straight through PostgREST",
        patch: { status: "approved" },
        column: "status",
        expected: "pending",
      },
      {
        id: "counseling-direct:requested-start",
        property: "a professor must not rewrite the requested start time directly",
        patch: { requested_start: "2030-01-01T09:00:00.000Z" },
        column: "requested_start",
        expected: null, // compared against the value captured before the patch
      },
      {
        id: "counseling-direct:student",
        property: "a professor must not reassign a request to another student",
        patch: { student_id: B.profile.id },
        column: "student_id",
        expected: null,
      },
      {
        id: "counseling-direct:suggested",
        property: "a professor must not write suggested times directly",
        patch: { suggested_start: "2030-01-01T10:00:00.000Z" },
        column: "suggested_start",
        expected: null,
      },
    ];

    for (const probe of counselingWrites) {
      const [before] = await rest.select(
        "counseling_requests",
        `select=${probe.column}&id=eq.${A.counseling.id}`,
      );
      const baseline = probe.expected ?? before?.[probe.column] ?? null;

      const res = await asProfA(`counseling_requests?id=eq.${A.counseling.id}`, {
        method: "PATCH",
        body: JSON.stringify(probe.patch),
      });

      const [after] = await rest.select(
        "counseling_requests",
        `select=${probe.column}&id=eq.${A.counseling.id}`,
      );
      const unchanged = String(after?.[probe.column] ?? null) === String(baseline);
      if (!unchanged) {
        await rest.update("counseling_requests", `id=eq.${A.counseling.id}`, {
          [probe.column]: baseline,
        });
      }
      check(
        probe.id,
        probe.property,
        unchanged,
        `PATCH ${res.status}; ${probe.column} is now ${JSON.stringify(after?.[probe.column] ?? null)}`,
      );
    }

    // The professor must still be able to READ their own caseload — the server
    // action path depends on it, and denying everyone is not a fix.
    {
      const { status, body } = await asProfA(
        `counseling_requests?select=id,topic&id=eq.${A.counseling.id}`,
      );
      check(
        "allow:professor-reads-own-caseload",
        "a professor CAN still read their own counseling request",
        status === 200 && rowCount(body) === 1,
        `status ${status}, ${rowCount(body) ?? "?"} row(s)`,
      );
    }

    // ------------------------------- roadmap workflow tenant scope (Codex F4)
    // The workflow had no tenant column at all, so staff of any university
    // could read every request and an admin of any university could approve
    // one — and approving merges the patch into the roadmap students read.
    {
      const { status, body } = await asProfA(
        `roadmap_revision_requests?select=id,title&id=eq.${B.revision.id}`,
      );
      check(
        "roadmap:cross-tenant-read",
        "tenant A staff must not read tenant B's roadmap revision request",
        status === 200 && rowCount(body) === 0,
        `status ${status}, ${rowCount(body) ?? "?"} row(s)`,
      );
    }
    {
      const { status } = await asProfA(`roadmap_revision_requests?id=eq.${B.revision.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "approved" }),
      });
      const [after] = await rest.select(
        "roadmap_revision_requests",
        `select=status&id=eq.${B.revision.id}`,
      );
      if (after?.status !== "pending") {
        await rest.update("roadmap_revision_requests", `id=eq.${B.revision.id}`, {
          status: "pending",
        });
      }
      check(
        "roadmap:cross-tenant-approve",
        "tenant A staff must not approve tenant B's revision even with the exact UUID",
        after?.status === "pending",
        `PATCH ${status}; status is now ${JSON.stringify(after?.status ?? null)}`,
      );
    }
    {
      const { status, body } = await asProfA(
        `roadmap_revision_requests?select=id&id=eq.${A.revision.id}`,
      );
      check(
        "allow:staff-reads-own-tenant-revision",
        "tenant A staff CAN read their own tenant's revision request",
        status === 200 && rowCount(body) === 1,
        `status ${status}, ${rowCount(body) ?? "?"} row(s)`,
      );
    }

    // ---------------- provenance and tenant immutability (Codex round 3) -----
    // Every outcome below is read back with the SERVICE ROLE. A PATCH that
    // returns 200 with an empty representation, or is hidden by a SELECT policy,
    // proves nothing about what is actually stored.
    const mutationProbes = [
      {
        id: "review:cross-tenant-move",
        property: "a review must not be moved to another tenant's course (F2)",
        table: "course_reviews",
        id_: A.review.id,
        patch: { course_id: B.course.id },
        column: "course_id",
        mustRemain: A.course.id,
      },
      {
        id: "review:same-tenant-move",
        property: "a review's course is immutable, even within the same tenant (F2)",
        table: "course_reviews",
        id_: A.review.id,
        patch: { course_id: A.courseAlt.id },
        column: "course_id",
        mustRemain: A.course.id,
      },
      {
        id: "review:author-reassign",
        property: "a review's author must not be reassigned",
        table: "course_reviews",
        id_: A.review.id,
        patch: { author_id: B.profile.id },
        column: "author_id",
        mustRemain: A.profile.id,
      },
      {
        id: "post:promote-to-professor-community",
        property: "a student must not mutate their post into the professor community (F3)",
        table: "posts",
        id_: A.post.id,
        patch: { community_type: "professor" },
        column: "community_type",
        mustRemain: "student",
      },
      {
        id: "post:promote-to-course-notice",
        property: "a student must not mutate their post into a trusted course notice (F3)",
        table: "posts",
        id_: A.post.id,
        patch: { board_key: "course_notice" },
        column: "board_key",
        mustRemain: "question",
      },
      {
        id: "post:move-tenant",
        property: "a student must not move their post into another tenant",
        table: "posts",
        id_: A.post.id,
        patch: { school_id: B.school.id },
        column: "school_id",
        mustRemain: A.school.id,
      },
    ];

    for (const probe of mutationProbes) {
      const { status } = await asA(`${probe.table}?id=eq.${probe.id_}`, {
        method: "PATCH",
        body: JSON.stringify(probe.patch),
      });
      const [after] = await rest.select(probe.table, `select=${probe.column}&id=eq.${probe.id_}`);
      const unchanged = String(after?.[probe.column] ?? null) === String(probe.mustRemain);
      if (!unchanged) {
        await rest.update(probe.table, `id=eq.${probe.id_}`, { [probe.column]: probe.mustRemain });
      }
      check(
        probe.id,
        probe.property,
        unchanged,
        `PATCH ${status}; ${probe.column} is now ${JSON.stringify(after?.[probe.column] ?? null)}`,
      );
    }

    // A student must not be able to CREATE a trusted notice either.
    {
      const tagged = tag("xt-notice");
      const { status } = await asA("posts", {
        method: "POST",
        body: JSON.stringify({
          author_id: A.profile.id,
          school_id: A.school.id,
          course_id: A.course.id,
          community_type: "student",
          board_key: "course_notice",
          category: "notice",
          title: tagged,
          content: tagged,
          status: "active",
        }),
      });
      const rows = await rest
        .select("posts", `select=id&title=eq.${encodeURIComponent(tagged)}`)
        .catch(() => null);
      if (rows === null) {
        check("post:create-course-notice", "a student must not create a trusted course notice (F3)", false, "read-back FAILED");
      } else {
        for (const row of rows) ledger.recordRow("posts", row.id, "leaked course_notice");
        check(
          "post:create-course-notice",
          "a student must not create a trusted course notice (F3)",
          rows.length === 0,
          `POST ${status}; ${rows.length} row(s) in the database`,
        );
      }
    }

    // The author must still be able to edit what a review/post IS.
    {
      const edited = tag("edited-review");
      const { status } = await asA(`course_reviews?id=eq.${A.review.id}`, {
        method: "PATCH",
        body: JSON.stringify({ content: edited }),
      });
      const [after] = await rest.select("course_reviews", `select=content&id=eq.${A.review.id}`);
      check(
        "allow:author-edits-own-review",
        "an author CAN still edit their own review's content",
        after?.content === edited,
        `PATCH ${status}; content is ${after?.content === edited ? "updated" : "unchanged"}`,
      );
    }
    {
      const edited = tag("edited-post");
      const { status } = await asA(`posts?id=eq.${A.post.id}`, {
        method: "PATCH",
        body: JSON.stringify({ content: edited }),
      });
      const [after] = await rest.select("posts", `select=content&id=eq.${A.post.id}`);
      check(
        "allow:author-edits-own-post",
        "an author CAN still edit their own post's content",
        after?.content === edited,
        `PATCH ${status}; content is ${after?.content === edited ? "updated" : "unchanged"}`,
      );
    }

    // ---------------- FAQ tenant isolation (Codex round 3, F4) --------------
    {
      const { status, body } = await asB(`faqs?select=id&id=eq.${A.courselessFaq.id}`);
      check(
        "faq:cross-tenant-courseless",
        "an approved FAQ with no course must not leak to another tenant (F4)",
        status === 200 && rowCount(body) === 0,
        `status ${status}, ${rowCount(body) ?? "?"} row(s)`,
      );
    }
    {
      const { status, body } = await asA(`faqs?select=id&id=eq.${A.courselessFaq.id}`);
      check(
        "allow:faq-own-tenant-courseless",
        "an approved course-less FAQ IS visible inside its own tenant",
        status === 200 && rowCount(body) === 1,
        `status ${status}, ${rowCount(body) ?? "?"} row(s)`,
      );
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
  });

  console.log("\n=== Stage 9 direct Data API probe ===\n");
  let failed = 0;
  for (const r of results) {
    if (!r.pass) failed += 1;
    console.log(`[${r.pass ? "PASS" : "FAIL"}] ${r.id}\n        ${r.property}\n        ${r.detail}`);
  }
  console.log(`\n${results.length} checks, ${failed} FAILED (each failure is a security finding).`);

  console.log("\n=== Fixture cleanup ===");
  if (cleanupFailures.length) {
    for (const failure of cleanupFailures) {
      console.error(`[CLEANUP FAILED] ${failure.table} ${failure.id} (${failure.label}): ${failure.message}`);
    }
  } else {
    console.log("All ledgered resources removed.");
  }
  if (residue.residue.length) {
    for (const entry of residue.residue) console.error(`[RESIDUE] ${entry}`);
  }
  if (residue.unverifiable.length) {
    for (const entry of residue.unverifiable) console.error(`[UNVERIFIABLE] ${entry}`);
  }
  if (residue.clean && !cleanupFailures.length) {
    console.log("Residue verification: clean.");
  } else {
    console.error(
      "\nRun `node scripts/security/rls-probe.mjs --sweep` to remove marked residue, then re-verify.",
    );
  }

  const jsonFlag = process.argv.indexOf("--json");
  if (jsonFlag !== -1 && process.argv[jsonFlag + 1]) {
    writeFileSync(
      process.argv[jsonFlag + 1],
      JSON.stringify({ results, cleanupFailures, residue }, null, 2),
    );
  }

  if (provisionOrProbeError) {
    console.error(`\nProbe aborted: ${provisionOrProbeError.message}`);
  }

  // A run that cannot PROVE it cleaned up is not a passing run, whatever the
  // security checks said.
  const ok =
    failed === 0 && cleanupFailures.length === 0 && residue.clean && !provisionOrProbeError;
  process.exit(ok ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
