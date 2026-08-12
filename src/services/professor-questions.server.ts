import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { normalizeUuid } from "@/lib/uuid";
import { resolveAuthenticatedProfile } from "@/services/request-identity.server";
import {
  createUserNotifications,
  createUserNotificationsWithClient,
} from "@/services/notifications.create.service";
import {
  professorQuestionCategories,
  type ProfessorQuestion,
  type ProfessorQuestionAnswerMode,
  type ProfessorQuestionAutoReplyRule,
  type ProfessorQuestionCategory,
  type ProfessorQuestionCourseOption,
  type ProfessorQuestionCreateResult,
  type ProfessorQuestionInbox,
  type ProfessorQuestionSourceKind,
  type ProfessorQuestionStatus,
  type StudentProfessorQuestion,
} from "@/types/professor-questions";

type ServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

type AuthProfile = {
  id: string;
  role: "student" | "professor" | "assistant";
};

type QuestionRow = {
  id: string;
  course_id: string;
  category: string;
  question: string;
  status: string;
  answer: string | null;
  created_at: string;
  answered_at: string | null;
  answer_mode: string | null;
  source_kind: string;
  question_fingerprint: string;
  is_anonymous: boolean;
};

type AutoReplyRuleRow = {
  id: string;
  course_id: string | null;
  category: string;
  pattern: string;
  answer: string;
  is_enabled: boolean;
};

type CreateQuestionRpcRow = {
  question_id: string;
  question_status: ProfessorQuestionStatus;
  question_answer: string | null;
  was_created: boolean;
  recipient_profile_id: string;
  resolved_source_kind: ProfessorQuestionSourceKind;
};

const QUESTION_STATUS_SET = new Set<ProfessorQuestionStatus>([
  "pending",
  "assigned",
  "answered",
  "closed",
]);
const SOURCE_KIND_SET = new Set<ProfessorQuestionSourceKind>(["direct", "tutor"]);
const ANSWER_MODE_SET = new Set<Exclude<ProfessorQuestionAnswerMode, null>>([
  "manual",
  "automatic",
]);
const CATEGORY_SET = new Set<string>(professorQuestionCategories);

export async function getStudentProfessorQuestionData(): Promise<{
  courses: ProfessorQuestionCourseOption[];
  questions: StudentProfessorQuestion[];
}> {
  const supabase = await createSupabaseServerClient();
  const profile = await getAuthProfile(supabase, "student");
  if (!profile) {
    return { courses: [], questions: [] };
  }

  const [courses, questions] = await Promise.all([
    getStudentQuestionCourses(supabase, profile.id),
    getQuestionRows(supabase),
  ]);
  const courseNames = new Map(courses.map((course) => [course.id, course.name]));

  return {
    courses,
    questions: questions.flatMap((row) => {
      const parsed = parseQuestionRow(row, courseNames);
      if (!parsed) {
        return [];
      }
      const { fingerprint: _fingerprint, ...question } = parsed;
      return [question];
    }),
  };
}

export async function getProfessorQuestionInbox(): Promise<ProfessorQuestionInbox> {
  const emptyInbox: ProfessorQuestionInbox = {
    groups: [],
    categoryCounts: createEmptyCategoryCounts(),
    rules: [],
  };
  const supabase = await createSupabaseServerClient();
  const profile = await getAuthProfile(supabase, ["professor", "assistant"]);
  if (!profile) {
    return emptyInbox;
  }

  const { data: professorRow, error: professorError } = profile.role === "professor"
    ? await supabase.from("professors").select("id").eq("profile_id", profile.id).maybeSingle()
    : { data: null, error: null };
  const professorId = professorRow ? normalizeUuid(professorRow.id) : null;
  if (profile.role === "professor" && (professorError || !professorId)) return emptyInbox;

  let questionQuery = supabase
    .from("escalations")
    .select(
      "id, course_id, category, question, status, answer, created_at, answered_at, answer_mode, source_kind, question_fingerprint, is_anonymous",
    )
    .order("created_at", { ascending: false });
  if (professorId) questionQuery = questionQuery.eq("professor_id", professorId);

  const [{ data: questionData, error: questionError }, { data: ruleData, error: ruleError }] =
    await Promise.all([
      questionQuery,
      profile.role === "assistant"
        ? Promise.resolve({ data: [] as AutoReplyRuleRow[], error: null })
        : supabase
            .from("professor_question_auto_reply_rules")
            .select("id, course_id, category, pattern, answer, is_enabled")
            .eq("professor_id", professorId)
            .order("created_at", { ascending: false }),
    ]);

  if (questionError || ruleError) {
    return emptyInbox;
  }

  const questionRows = (questionData ?? []) as QuestionRow[];
  const ruleRows = (ruleData ?? []) as AutoReplyRuleRow[];
  const courseIds = Array.from(
    new Set([
      ...questionRows.map((row) => row.course_id),
      ...ruleRows.flatMap((row) => (row.course_id ? [row.course_id] : [])),
    ]),
  );
  const courseNames = await getCourseNames(supabase, courseIds);
  const questions = questionRows.flatMap((row) => {
    const parsed = parseQuestionRow(row, courseNames);
    return parsed ? [parsed] : [];
  });
  if (questions.length !== questionRows.length) {
    return emptyInbox;
  }

  const categoryCounts = createEmptyCategoryCounts();
  const groups = new Map<string, ProfessorQuestionInbox["groups"][number]>();
  for (const question of questions) {
    if (question.status === "pending" || question.status === "assigned") {
      categoryCounts[question.category] += 1;
    }
    const key = `${question.courseId}:${question.category}:${question.fingerprint}`;
    const group = groups.get(key) ?? {
      key,
      courseId: question.courseId,
      courseName: question.courseName,
      category: question.category,
      fingerprint: question.fingerprint,
      pendingCount: 0,
      questions: [],
    };
    group.questions.push(question);
    if (question.status === "pending" || question.status === "assigned") {
      group.pendingCount += 1;
    }
    groups.set(key, group);
  }

  const rules = ruleRows.flatMap((row) => {
    const parsed = parseAutoReplyRule(row, courseNames);
    return parsed ? [parsed] : [];
  });
  if (rules.length !== ruleRows.length) {
    return emptyInbox;
  }

  return {
    categoryCounts,
    groups: Array.from(groups.values()).sort(
      (a, b) =>
        b.pendingCount - a.pendingCount ||
        a.category.localeCompare(b.category, "ko-KR") ||
        a.courseName.localeCompare(b.courseName, "ko-KR"),
    ),
    rules,
  };
}

export async function createProfessorQuestionRecord(input: {
  courseId: string;
  category: ProfessorQuestionCategory;
  question: string;
  submissionKey: string;
  sourceMessageId: string | null;
  sourceKind: ProfessorQuestionSourceKind;
  isAnonymous: boolean;
}): Promise<ProfessorQuestionCreateResult> {
  const supabase = await createSupabaseServerClient();
  const profile = await getAuthProfile(supabase, "student");
  if (!profile) {
    return { ok: false, code: "unauthenticated" };
  }

  const { data, error } = await supabase.rpc("create_professor_question", {
    p_course_id: input.courseId,
    p_category: input.category,
    p_question: input.question,
    p_submission_key: input.submissionKey,
    p_source_message_id: input.sourceMessageId,
    p_source_kind: input.sourceKind,
    p_is_anonymous: input.isAnonymous,
  });

  if (error || !Array.isArray(data) || data.length !== 1) {
    const routeFailure = error?.message.includes("route") || error?.message.includes("student course");
    return { ok: false, code: routeFailure ? "route_not_found" : "database_write_failed" };
  }

  const row = parseCreateQuestionRpcRow(data[0]);
  if (!row) {
    return { ok: false, code: "database_write_failed" };
  }

  let notificationDelivered = true;
  if (row.was_created) {
    const notificationResult = await createQuestionNotifications({
      courseId: input.courseId,
      professorProfileId: row.recipient_profile_id,
      isAutomaticallyAnswered: row.question_status === "answered",
      questionId: row.question_id,
    });
    notificationDelivered = notificationResult.ok;
  }

  return {
    ok: true,
    created: row.was_created,
    status: row.question_status,
    answer: row.question_answer,
    notificationDelivered,
  };
}

async function createQuestionNotifications(input: {
  courseId: string;
  professorProfileId: string;
  isAutomaticallyAnswered: boolean;
  questionId: string;
}) {
  const base = {
    category: "question" as const,
    targetHref: `/professor?tab=questions&sub=incoming-questions&questionId=${encodeURIComponent(input.questionId)}`,
  };
  if (input.isAutomaticallyAnswered) {
    return createUserNotifications([{
      ...base,
      recipientRole: null,
      recipientId: input.professorProfileId,
      title: "질문 자동 답변",
      body: "등록한 질문에 자동 답변이 도착했습니다.",
    }]);
  }

  try {
    const admin = createSupabaseAdminClient();
    const { data: course } = await admin
      .from("courses")
      .select("department_id")
      .eq("id", input.courseId)
      .maybeSingle();
    const { data: assistants } = course?.department_id
      ? await admin
          .from("profiles")
          .select("id")
          .eq("role", "assistant")
          .eq("department_id", course.department_id)
      : { data: [] as Array<{ id: string }> };
    const recipientIds = Array.from(new Set([
      input.professorProfileId,
      ...(assistants ?? []).map((assistant) => assistant.id),
    ])).filter((id) => normalizeUuid(id));
    return createUserNotificationsWithClient(
      admin,
      recipientIds.map((recipientId) => ({
        ...base,
        recipientRole: null,
        recipientId,
        title: "새 교수 질문",
        body: "담당 학과 과목에 새 질문이 등록되었습니다.",
      })),
    );
  } catch {
    return createUserNotifications([{
      ...base,
      recipientRole: null,
      recipientId: input.professorProfileId,
      title: "새 교수 질문",
      body: "담당 과목에 새 질문이 등록되었습니다.",
    }]);
  }
}

export async function getAuthenticatedProfessorIdentity(): Promise<{
  supabase: ServerClient;
  profileId: string;
  professorId: string;
} | null> {
  const supabase = await createSupabaseServerClient();
  const profile = await getAuthProfile(supabase, "professor");
  if (!profile || profile.role !== "professor") {
    return null;
  }
  const { data, error } = await supabase
    .from("professors")
    .select("id")
    .eq("profile_id", profile.id)
    .maybeSingle();
  const professorId = data ? normalizeUuid(data.id) : null;
  return error || !professorId
    ? null
    : { supabase, profileId: profile.id, professorId };
}

export async function getAuthenticatedQuestionStaffIdentity(): Promise<{
  supabase: ServerClient;
  profileId: string;
  role: "professor" | "assistant";
  professorId: string | null;
} | null> {
  const supabase = await createSupabaseServerClient();
  const profile = await getAuthProfile(supabase, ["professor", "assistant"]);
  if (!profile || (profile.role !== "professor" && profile.role !== "assistant")) return null;
  if (profile.role === "assistant") {
    return { supabase, profileId: profile.id, role: profile.role, professorId: null };
  }
  const { data, error } = await supabase
    .from("professors")
    .select("id")
    .eq("profile_id", profile.id)
    .maybeSingle();
  const professorId = data ? normalizeUuid(data.id) : null;
  return error || !professorId
    ? null
    : { supabase, profileId: profile.id, role: profile.role, professorId };
}

async function getAuthProfile(
  _supabase: ServerClient,
  expectedRole: AuthProfile["role"] | readonly AuthProfile["role"][],
): Promise<AuthProfile | null> {
  // Identity comes from the request-scoped resolver (one auth round trip +
  // profiles read per render, shared with the report services). Every failure
  // state collapses to null, exactly like the inline chain it replaces.
  const identity = await resolveAuthenticatedProfile();
  if (identity.status !== "ok") {
    return null;
  }
  const id = normalizeUuid(identity.profile.id);
  const role = identity.profile.role;
  if (
    !id ||
    !(Array.isArray(expectedRole) ? expectedRole.includes(role) : role === expectedRole)
  ) {
    return null;
  }
  return { id, role: role as AuthProfile["role"] };
}

export async function getStudentAiTutorCourses(): Promise<ProfessorQuestionCourseOption[]> {
  const supabase = await createSupabaseServerClient();
  const profile = await getAuthProfile(supabase, "student");
  if (!profile) return [];

  const { data: studentCourseData, error: studentCourseError } = await supabase
    .from("student_courses")
    .select("course_id")
    .eq("student_id", profile.id);
  if (studentCourseError || !studentCourseData?.length) return [];

  const courseIds = Array.from(
    new Set(studentCourseData.map((row) => normalizeUuid(row.course_id)).filter(Boolean)),
  ) as string[];
  if (!courseIds.length) return [];

  const { data: courseData, error: courseError } = await supabase
    .from("courses")
    .select("id, code, name")
    .in("id", courseIds)
    .order("name", { ascending: true });
  if (courseError) return [];

  return (courseData ?? []).flatMap((row) => {
    const id = normalizeUuid(row.id);
    return id && typeof row.code === "string" && typeof row.name === "string"
      ? [{ id, code: row.code, name: row.name }]
      : [];
  });
}

async function getStudentQuestionCourses(
  supabase: ServerClient,
  profileId: string,
): Promise<ProfessorQuestionCourseOption[]> {
  const { data: studentCourseData, error: studentCourseError } = await supabase
    .from("student_courses")
    .select("course_id, offering_id")
    .eq("student_id", profileId);
  if (studentCourseError || !studentCourseData?.length) {
    return [];
  }
  const courseIds = Array.from(new Set(studentCourseData.map((row) => row.course_id)));
  const offeringIds = studentCourseData.flatMap((row) => (row.offering_id ? [row.offering_id] : []));
  const [{ data: courseProfessorData }, { data: offeringData }] = await Promise.all([
    supabase.from("course_professors").select("course_id, professor_id").in("course_id", courseIds),
    offeringIds.length
      ? supabase.from("course_offerings").select("id, professor_id").in("id", offeringIds)
      : Promise.resolve({ data: [] as Array<{ id: string; professor_id: string }> }),
  ]);
  const professorIds = Array.from(
    new Set([
      ...(courseProfessorData ?? []).map((row) => row.professor_id),
      ...(offeringData ?? []).map((row) => row.professor_id),
    ]),
  );
  if (!professorIds.length) {
    return [];
  }
  const { data: professorData, error: professorError } = await supabase
    .from("professors")
    .select("id, profile_id")
    .in("id", professorIds);
  if (professorError) {
    return [];
  }
  const mappedProfessorIds = new Set(
    (professorData ?? []).filter((row) => row.profile_id).map((row) => row.id),
  );
  const offeringProfessorById = new Map(
    (offeringData ?? []).map((row) => [row.id, row.professor_id]),
  );
  const courseProfessorIds = new Map<string, Set<string>>();
  for (const row of courseProfessorData ?? []) {
    if (!mappedProfessorIds.has(row.professor_id)) continue;
    const current = courseProfessorIds.get(row.course_id) ?? new Set<string>();
    current.add(row.professor_id);
    courseProfessorIds.set(row.course_id, current);
  }
  const routableCourseIds = new Set(
    studentCourseData.flatMap((row) => {
      if (row.offering_id) {
        const professorId = offeringProfessorById.get(row.offering_id);
        return professorId && mappedProfessorIds.has(professorId) ? [row.course_id] : [];
      }
      return courseProfessorIds.get(row.course_id)?.size === 1 ? [row.course_id] : [];
    }),
  );
  if (!routableCourseIds.size) {
    return [];
  }
  const { data: courseData, error: courseError } = await supabase
    .from("courses")
    .select("id, code, name")
    .in("id", Array.from(routableCourseIds))
    .order("name", { ascending: true });
  if (courseError) {
    return [];
  }
  return (courseData ?? []).flatMap((row) => {
    const id = normalizeUuid(row.id);
    return id && typeof row.code === "string" && typeof row.name === "string"
      ? [{ id, code: row.code, name: row.name }]
      : [];
  });
}

async function getQuestionRows(supabase: ServerClient) {
  const { data, error } = await supabase
    .from("escalations")
    .select(
      "id, course_id, category, question, status, answer, created_at, answered_at, answer_mode, source_kind, question_fingerprint, is_anonymous",
    )
    .order("created_at", { ascending: false });
  return error ? [] : ((data ?? []) as QuestionRow[]);
}

async function getCourseNames(supabase: ServerClient, courseIds: string[]) {
  if (!courseIds.length) return new Map<string, string>();
  const { data, error } = await supabase.from("courses").select("id, name").in("id", courseIds);
  return error
    ? new Map<string, string>()
    : new Map((data ?? []).map((course) => [course.id, course.name]));
}

function parseQuestionRow(row: QuestionRow, courseNames: Map<string, string>): ProfessorQuestion | null {
  const id = normalizeUuid(row.id);
  const courseId = normalizeUuid(row.course_id);
  const courseName = courseId ? courseNames.get(courseId) : null;
  const category = CATEGORY_SET.has(row.category) ? (row.category as ProfessorQuestionCategory) : null;
  const status = QUESTION_STATUS_SET.has(row.status as ProfessorQuestionStatus)
    ? (row.status as ProfessorQuestionStatus)
    : null;
  const sourceKind = SOURCE_KIND_SET.has(row.source_kind as ProfessorQuestionSourceKind)
    ? (row.source_kind as ProfessorQuestionSourceKind)
    : null;
  const answerMode =
    row.answer_mode === null
      ? null
      : ANSWER_MODE_SET.has(row.answer_mode as Exclude<ProfessorQuestionAnswerMode, null>)
        ? (row.answer_mode as Exclude<ProfessorQuestionAnswerMode, null>)
        : undefined;
  if (
    !id || !courseId || !courseName || !category || !status || !sourceKind ||
    answerMode === undefined || !row.question.trim() || !row.question_fingerprint
  ) {
    return null;
  }
  return {
    id,
    courseId,
    courseName,
    category,
    question: row.question,
    status,
    answer: row.answer,
    createdAt: row.created_at,
    answeredAt: row.answered_at,
    answerMode,
    sourceKind,
    isAnonymous: row.is_anonymous === true,
    fingerprint: row.question_fingerprint,
  };
}

function parseAutoReplyRule(
  row: AutoReplyRuleRow,
  courseNames: Map<string, string>,
): ProfessorQuestionAutoReplyRule | null {
  const id = normalizeUuid(row.id);
  const courseId = row.course_id ? normalizeUuid(row.course_id) : null;
  const category = CATEGORY_SET.has(row.category) ? (row.category as ProfessorQuestionCategory) : null;
  if (!id || (row.course_id && !courseId) || !category || !row.pattern.trim() || !row.answer.trim()) {
    return null;
  }
  return {
    id,
    courseId,
    courseName: courseId ? courseNames.get(courseId) ?? null : null,
    category,
    pattern: row.pattern,
    answer: row.answer,
    isEnabled: row.is_enabled,
  };
}

function parseCreateQuestionRpcRow(value: unknown): CreateQuestionRpcRow | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<CreateQuestionRpcRow>;
  const questionId = typeof row.question_id === "string" ? normalizeUuid(row.question_id) : null;
  const recipientProfileId =
    typeof row.recipient_profile_id === "string" ? normalizeUuid(row.recipient_profile_id) : null;
  const status = QUESTION_STATUS_SET.has(row.question_status as ProfessorQuestionStatus)
    ? (row.question_status as ProfessorQuestionStatus)
    : null;
  const sourceKind = SOURCE_KIND_SET.has(row.resolved_source_kind as ProfessorQuestionSourceKind)
    ? (row.resolved_source_kind as ProfessorQuestionSourceKind)
    : null;
  if (!questionId || !recipientProfileId || !status || !sourceKind || typeof row.was_created !== "boolean") {
    return null;
  }
  return {
    question_id: questionId,
    question_status: status,
    question_answer: typeof row.question_answer === "string" ? row.question_answer : null,
    was_created: row.was_created,
    recipient_profile_id: recipientProfileId,
    resolved_source_kind: sourceKind,
  };
}

function createEmptyCategoryCounts() {
  return Object.fromEntries(
    professorQuestionCategories.map((category) => [category, 0]),
  ) as Record<ProfessorQuestionCategory, number>;
}
