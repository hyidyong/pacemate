// Disposable two-tenant fixture for the Stage 9 security probes.
//
// Provisions two complete miniature universities that exist only for the
// duration of one run:
//
//   tenant A — school, department, professor, course, availability, student
//              (profile + auth user + student_profile), enrolment, counseling
//              request, direct notification, role broadcast, mission progress
//   tenant B — the same shape, so every "A must not see B" assertion has a real
//              row on the other side instead of a hypothetical one
//
// Codex finding 1 changed how this file works, not what it creates. EVERY
// resource is written into the caller's ProbeLedger the instant it exists and
// before the next operation that could fail, so a throw halfway through leaves
// the caller holding a complete removal list. This function no longer owns any
// cleanup responsibility and no longer has a rescue `catch`: the caller's
// top-level `finally` covers provisioning itself.
//
// Both tenants carry THIS RUN's marker in `schools.slug`, and every row carries
// it in a text column wherever the schema has one (Codex round 5, F6: the
// marker is a per-execution random token, not a shared constant).

import { createRunMarker, isProbeTenant, tenantSlugPrefix } from "./probe-guard.mjs";

export const PROBE_PASSWORD = "Stage9-probe-!aA9";

export function makeRunId(now = Date.now(), random = Math.random()) {
  return `${now.toString(36)}${random.toString(36).slice(2, 6)}`;
}

/**
 * Insert one row and record it in the ledger before returning.
 *
 * The record happens after the insert resolves (we need the id) and before the
 * caller can perform any further work, which is the tightest window the API
 * allows. If the insert itself fails, nothing was created and nothing needs
 * recording.
 */
async function createRow(ledger, table, row, label) {
  const inserted = await ledger.rest.insert(table, [row]);
  const created = Array.isArray(inserted) ? inserted[0] : inserted;
  if (!created?.id) {
    throw new Error(`insert into ${table} returned no id (${label})`);
  }
  ledger.recordRow(table, created.id, label);
  return created;
}

async function createAuthUser(ledger, email, label) {
  const user = await ledger.auth.createUser(email, PROBE_PASSWORD);
  if (!user?.id) {
    throw new Error(`GoTrue create user returned no id (${label})`);
  }
  ledger.recordAuthUser(user.id, label);
  return user;
}

/**
 * @param {import('./probe-ledger.mjs').ProbeLedger} ledger
 */
export async function provisionTenant(ledger, label, runId, runMarker) {
  const slug = `${tenantSlugPrefix(runMarker)}${label}-${runId}`;

  const school = await createRow(
    ledger,
    "schools",
    { name: `${runMarker} university ${label}`, slug, status: "active" },
    `school ${label}`,
  );

  // The harness only writes into a tenant the DATABASE confirms is a probe
  // tenant, even though it just created it. Runs AFTER the ledger entry, so a
  // failed confirmation still leaves the school removable.
  const [confirmed] = await ledger.rest.select("schools", `select=id,name,slug&id=eq.${school.id}`);
  if (!isProbeTenant(confirmed, runMarker)) {
    throw new Error(`provisioned tenant ${school.id} does not carry the probe marker — aborting`);
  }

  const department = await createRow(
    ledger,
    "departments",
    { school_id: school.id, name: `${runMarker} department ${label}` },
    `department ${label}`,
  );

  // The professor gets a real identity (auth user + profile + linked professors
  // row) so `app_private.current_professor_id()` resolves for them. Without it
  // no probe can exercise a professor-scoped policy at all.
  const professorEmail = `${runMarker}-prof-${label}-${runId}@probe.invalid`;
  const professorAuthUser = await createAuthUser(ledger, professorEmail, `professor auth user ${label}`);

  const professorProfile = await createRow(
    ledger,
    "profiles",
    {
      identifier: professorEmail,
      name: `${runMarker} professor profile ${label}`,
      role: "professor",
      school_id: school.id,
      department_id: department.id,
      auth_user_id: professorAuthUser.id,
    },
    `professor profile ${label}`,
  );

  const professor = await createRow(
    ledger,
    "professors",
    {
      school_id: school.id,
      department_id: department.id,
      profile_id: professorProfile.id,
      name: `${runMarker} professor ${label}`,
      email: professorEmail,
    },
    `professor ${label}`,
  );

  const course = await createRow(
    ledger,
    "courses",
    {
      school_id: school.id,
      department_id: department.id,
      code: `PB-${label}-${runId}`.slice(0, 20),
      name: `${runMarker} course ${label}`,
      credit: 3,
    },
    `course ${label}`,
  );

  // A SECOND course in the SAME tenant. Without it, "the review could not be
  // moved" is ambiguous: a cross-tenant move is also refused simply because the
  // moved row stops satisfying the tenant-scoped SELECT policy. Moving within
  // the tenant isolates whether course_id is genuinely constrained.
  const courseAlt = await createRow(
    ledger,
    "courses",
    {
      school_id: school.id,
      department_id: department.id,
      code: `PBALT-${label}-${runId}`.slice(0, 20),
      name: `${runMarker} alt course ${label}`,
      credit: 3,
    },
    `alt course ${label}`,
  );

  const availability = await createRow(
    ledger,
    "professor_availability",
    {
      professor_id: professor.id,
      day_of_week: 1,
      start_time: "10:00:00",
      end_time: "11:00:00",
      slot_minutes: 30,
      is_active: true,
    },
    `availability ${label}`,
  );

  const email = `${runMarker}-${label}-${runId}@probe.invalid`;
  const authUser = await createAuthUser(ledger, email, `auth user ${label}`);

  const profile = await createRow(
    ledger,
    "profiles",
    {
      identifier: email,
      name: `${runMarker} student ${label}`,
      role: "student",
      school_id: school.id,
      department_id: department.id,
      auth_user_id: authUser.id,
    },
    `profile ${label}`,
  );

  const studentProfile = await createRow(
    ledger,
    "student_profiles",
    { profile_id: profile.id, grade: 1, semester: 1, is_onboarded: true },
    `student profile ${label}`,
  );

  const enrolment = await createRow(
    ledger,
    "student_courses",
    {
      student_id: profile.id,
      course_id: course.id,
      status: "interested",
      semester_label: "2026-2",
      source_text: runMarker,
    },
    `enrolment ${label}`,
  );

  const start = new Date(Date.now() + 7 * 24 * 3600 * 1000);
  start.setUTCMinutes(0, 0, 0);
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  const counseling = await createRow(
    ledger,
    "counseling_requests",
    {
      student_id: profile.id,
      professor_id: professor.id,
      requested_start: start.toISOString(),
      requested_end: end.toISOString(),
      topic: `${runMarker} confidential counseling topic ${label}`,
      status: "pending",
    },
    `counseling ${label}`,
  );

  const directNotification = await createRow(
    ledger,
    "user_notifications",
    {
      recipient_id: profile.id,
      recipient_role: null,
      school_id: school.id,
      category: "system",
      title: `${runMarker} direct ${label}`,
      body: `${runMarker} direct body ${label}`,
      target_href: "/notifications",
    },
    `direct notification ${label}`,
  );

  // Codex round 4, finding 1: a role broadcast is now stored as one row PER
  // RECIPIENT (`recipient_id` is NOT NULL as of 20260814150000). The shared
  // NULL-recipient row this fixture used to create is no longer insertable, and
  // modelling it would test a shape the application can no longer produce.
  const broadcast = await createRow(
    ledger,
    "user_notifications",
    {
      recipient_id: profile.id,
      recipient_role: "student",
      school_id: school.id,
      category: "system",
      title: `${runMarker} broadcast ${label}`,
      body: `${runMarker} broadcast body ${label}`,
      target_href: "/notifications",
    },
    `broadcast ${label}`,
  );

  // A pending roadmap revision belonging to this tenant, so cross-tenant read
  // and approval can be attacked with a real UUID (Codex F4).
  const revision = await createRow(
    ledger,
    "roadmap_revision_requests",
    {
      scope: "course",
      status: "pending",
      school_id: school.id,
      // roadmap_revision_scope_target requires a target for the chosen scope.
      course_code: `PB-${label}-${runId}`.slice(0, 20),
      department_name: `${runMarker} dept ${label}`,
      title: `${runMarker} revision ${label}`,
      summary: `${runMarker} revision summary ${label}`,
      proposed_by: professorProfile.id,
      proposed_by_name: `${runMarker} professor ${label}`,
      proposed_patch: { shortReason: `${runMarker} patch ${label}` },
    },
    `roadmap revision ${label}`,
  );

  // Provenance fixtures (Codex round 3, F2/F3/F4): a review the student owns, an
  // ordinary student post they own, and an approved FAQ with NO course, so each
  // mutation probe has a real row of its own to attack.
  const review = await createRow(
    ledger,
    "course_reviews",
    {
      course_id: course.id,
      author_id: profile.id,
      difficulty: 3,
      workload: 3,
      grading_style: `${runMarker} grading ${label}`,
      team_project: false,
      content: `${runMarker} review ${label}`,
    },
    `review ${label}`,
  );

  const post = await createRow(
    ledger,
    "posts",
    {
      author_id: profile.id,
      school_id: school.id,
      course_id: course.id,
      community_type: "student",
      board_key: "question",
      category: "free",
      title: `${runMarker} post ${label}`,
      content: `${runMarker} post body ${label}`,
      status: "active",
    },
    `post ${label}`,
  );

  const courselessFaq = await createRow(
    ledger,
    "faqs",
    {
      question: `${runMarker} courseless faq ${label}`,
      answer: `${runMarker} courseless answer ${label}`,
      category: `${runMarker}`,
      course_id: null,
      professor_id: professor.id,
      approved_at: new Date().toISOString(),
    },
    `courseless faq ${label}`,
  );

  const mission = await createRow(
    ledger,
    "student_mission_progress",
    {
      student_id: profile.id,
      course_id: course.id,
      week_number: 1,
      is_completed: false,
      actual_progress_feedback: `${runMarker} private feedback ${label}`,
    },
    `mission ${label}`,
  );

  return {
    label,
    school,
    department,
    professorEmail,
    professorProfile,
    professorAuthUserId: professorAuthUser.id,
    professor,
    course,
    courseAlt,
    availability,
    email,
    authUserId: authUser.id,
    profile,
    studentProfile,
    enrolment,
    counseling,
    directNotification,
    broadcast,
    mission,
    revision,
    review,
    post,
    courselessFaq,
  };
}

/**
 * Provision both tenants. Deliberately has NO rescue `catch`: cleanup belongs to
 * the caller's top-level `finally`, which also covers the case where this
 * function never returns at all.
 */
/**
 * Codex round 4, finding 2 — signed-in STAFF identities in tenant A.
 *
 * Course reviews are student experience (`/reviews` is gated by
 * `redirectNonStudent`), but nothing outside that route said so: the INSERT
 * policy checked authorship and tenancy only, and the server action checked
 * only that a session existed. Proving the invariant needs a real professor, a
 * real assistant and a real admin who can sign in and attempt the write — a
 * denial that rests on "no such user exists" proves nothing.
 *
 * These live only in tenant A; tenant B's probes are about cross-tenant reach
 * and do not need them.
 */
async function provisionStaff(ledger, school, label, runId, role, runMarker) {
  const email = `${runMarker}-${role}-${label}-${runId}@probe.invalid`;
  const authUser = await createAuthUser(ledger, email, `${role} auth user ${label}`);
  const profile = await createRow(
    ledger,
    "profiles",
    {
      identifier: email,
      name: `${runMarker} ${role} ${label}`,
      role,
      school_id: school.id,
      auth_user_id: authUser.id,
    },
    `${role} profile ${label}`,
  );
  return { email, profile };
}

/** Positive sentinels for every table in the anonymous-read matrix. */
async function provisionReadSentinels(ledger, tenant, runId, runMarker) {
  const today = new Date();
  const startsOn = today.toISOString().slice(0, 10);
  const endsOn = new Date(today.getTime() + 120 * 24 * 3600 * 1000)
    .toISOString()
    .slice(0, 10);

  const term = await createRow(ledger, "academic_terms", {
    school_id: tenant.school.id,
    semester_label: runMarker,
    starts_on: startsOn,
    ends_on: endsOn,
    total_weeks: 15,
    is_active: false,
  }, "read sentinel academic term");
  const offering = await createRow(ledger, "course_offerings", {
    course_id: tenant.course.id,
    professor_id: tenant.professor.id,
    term_id: term.id,
    section_label: runMarker,
    starts_on: startsOn,
    ends_on: endsOn,
  }, "read sentinel course offering");
  const studentCourseProgress = await createRow(ledger, "student_course_progress", {
    student_id: tenant.profile.id,
    offering_id: offering.id,
    status: "not_started",
  }, "read sentinel student course progress");
  const studentWeeklyProgress = await createRow(ledger, "student_weekly_progress", {
    student_id: tenant.profile.id,
    offering_id: offering.id,
    week_number: 2,
    private_note: `${runMarker} weekly private note`,
  }, "read sentinel student weekly progress");
  const chatSession = await createRow(ledger, "chat_sessions", {
    user_id: tenant.profile.id,
    offering_id: offering.id,
    title: `${runMarker} chat session`,
  }, "read sentinel chat session");
  const chatMessage = await createRow(ledger, "chat_messages", {
    session_id: chatSession.id,
    role: "user",
    content: `${runMarker} private chat message`,
  }, "read sentinel chat message");
  const escalation = await createRow(ledger, "escalations", {
    user_id: tenant.profile.id,
    assigned_to: tenant.professorProfile.id,
    category: "상담 필요",
    question: `${runMarker} private professor question`,
    offering_id: offering.id,
    course_id: tenant.course.id,
    professor_id: tenant.professor.id,
    source_kind: "direct",
    submission_key: globalThis.crypto.randomUUID(),
  }, "read sentinel escalation");
  const comment = await createRow(ledger, "comments", {
    post_id: tenant.post.id,
    author_id: tenant.profile.id,
    content: `${runMarker} private comment`,
  }, "read sentinel comment");
  const reaction = await createRow(ledger, "post_reactions", {
    post_id: tenant.post.id,
    user_id: tenant.profile.id,
    type: "like",
  }, "read sentinel reaction");
  const report = await createRow(ledger, "reports", {
    target_type: "post",
    target_id: tenant.post.id,
    reporter_id: tenant.profile.id,
    reason: `${runMarker} private abuse report`,
  }, "read sentinel report");
  const professorTask = await createRow(ledger, "professor_admin_tasks", {
    professor_id: tenant.professor.id,
    title: `${runMarker} private professor task`,
    day_of_week: 2,
    start_time: "12:00:00",
    end_time: "12:30:00",
  }, "read sentinel professor task");
  const studyRoadmap = await createRow(ledger, "study_roadmaps", {
    student_id: tenant.profile.id,
    course_id: tenant.course.id,
    offering_id: offering.id,
    title: `${runMarker} private study roadmap`,
    status: "draft",
  }, "read sentinel study roadmap");
  const studyTask = await createRow(ledger, "study_tasks", {
    roadmap_id: studyRoadmap.id,
    course_id: tenant.course.id,
    student_id: tenant.profile.id,
    title: `${runMarker} private study task`,
  }, "read sentinel study task");
  const roadmapRequest = await createRow(ledger, "roadmap_requests", {
    student_id: tenant.profile.id,
    input_json: { probeRun: runMarker },
  }, "read sentinel roadmap request");
  const roadmapResult = await createRow(ledger, "roadmap_results", {
    request_id: roadmapRequest.id,
    result_json: { probeRun: runMarker },
    source_summary: `${runMarker} private roadmap result`,
  }, "read sentinel roadmap result");
  const autoReplyRule = await createRow(ledger, "professor_question_auto_reply_rules", {
    professor_id: tenant.professor.id,
    course_id: tenant.course.id,
    category: "상담 필요",
    pattern: `${runMarker} pattern`,
    answer: `${runMarker} private automatic answer`,
    is_enabled: false,
  }, "read sentinel professor auto-reply rule");
  const syllabus = await createRow(ledger, "syllabi", {
    course_id: tenant.course.id,
    source_name: `${runMarker} private syllabus`,
    parsed_text: `${runMarker} private syllabus body`,
    uploaded_by: tenant.professorProfile.id,
  }, "read sentinel syllabus");
  const teachingSlot = await createRow(ledger, "professor_teaching_slots", {
    professor_id: tenant.professor.id,
    course_id: tenant.course.id,
    day_of_week: 2,
    period_label: `${runMarker} period`,
    start_time: "13:00:00",
    end_time: "14:00:00",
    classroom: `${runMarker} room`,
    semester_label: runMarker,
  }, "read sentinel professor teaching slot");
  const courseProfessor = await createRow(ledger, "course_professors", {
    course_id: tenant.course.id,
    professor_id: tenant.professor.id,
    semester_label: runMarker,
  }, "read sentinel course professor");
  const notice = await createRow(ledger, "notices", {
    title: `${runMarker} private notice`,
    content: `${runMarker} private notice body`,
    course_id: tenant.course.id,
    created_by: tenant.professorProfile.id,
  }, "read sentinel notice");

  return {
    term, offering, studentCourseProgress, studentWeeklyProgress, chatSession,
    chatMessage, escalation, comment, reaction, report, professorTask,
    studyRoadmap, studyTask, roadmapRequest, roadmapResult, autoReplyRule,
    syllabus, teachingSlot, courseProfessor, notice,
  };
}

export async function provisionProbeTenants(ledger, runMarker, runId = makeRunId()) {
  if (typeof runMarker !== "string" || runMarker.length < 20) {
    throw new Error("provisionProbeTenants requires an execution-specific run marker (F6)");
  }
  const tenants = {};
  tenants.A = await provisionTenant(ledger, "a", runId, runMarker);
  tenants.B = await provisionTenant(ledger, "b", runId, runMarker);

  tenants.A.staff = {
    assistant: await provisionStaff(ledger, tenants.A.school, "a", runId, "assistant", runMarker),
    admin: await provisionStaff(ledger, tenants.A.school, "a", runId, "admin", runMarker),
  };

  const extra = await provisionReadSentinels(ledger, tenants.A, runId, runMarker);
  const readSentinels = {
    profiles: tenants.A.profile.id,
    student_profiles: tenants.A.studentProfile.id,
    student_courses: tenants.A.enrolment.id,
    student_mission_progress: tenants.A.mission.id,
    student_weekly_progress: extra.studentWeeklyProgress.id,
    student_course_progress: extra.studentCourseProgress.id,
    counseling_requests: tenants.A.counseling.id,
    user_notifications: tenants.A.directNotification.id,
    chat_sessions: extra.chatSession.id,
    chat_messages: extra.chatMessage.id,
    escalations: extra.escalation.id,
    posts: tenants.A.post.id,
    comments: extra.comment.id,
    post_reactions: extra.reaction.id,
    reports: extra.report.id,
    professor_admin_tasks: extra.professorTask.id,
    study_roadmaps: extra.studyRoadmap.id,
    study_tasks: extra.studyTask.id,
    roadmap_requests: extra.roadmapRequest.id,
    roadmap_results: extra.roadmapResult.id,
    roadmap_revision_requests: tenants.A.revision.id,
    professor_question_auto_reply_rules: extra.autoReplyRule.id,
    syllabi: extra.syllabus.id,
    professor_teaching_slots: extra.teachingSlot.id,
    professor_availability: tenants.A.availability.id,
    course_professors: extra.courseProfessor.id,
    course_reviews: tenants.A.review.id,
    faqs: tenants.A.courselessFaq.id,
    notices: extra.notice.id,
    schools: tenants.A.school.id,
    departments: tenants.A.department.id,
    courses: tenants.A.course.id,
    professors: tenants.A.professor.id,
  };

  return { runId, runMarker, tenants, readSentinels };
}

export { createRunMarker };
