import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const { transpileModule, ModuleKind, ScriptTarget } = require("typescript");
const toDataUrl = (code) => `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;

const questionSource = await readFile(new URL("./ask.actions.ts", import.meta.url), "utf8");
const noticeSource = await readFile(new URL("./course-settings.actions.ts", import.meta.url), "utf8");
const assistantMigration = await readFile(
  new URL("../../supabase/migrations/20260714134426_allow_assistant_question_workflow.sql", import.meta.url),
  "utf8",
);

const NEXT_CACHE_STUB = toDataUrl(
  "export const revalidatePath = (path) => globalThis.__stage10QuestionRevalidated.push(path);",
);
const NORMALIZATION_STUB = toDataUrl(`
  export const normalizeQuestionCategory = (value) => value === "수업 운영" ? value : null;
  export const validateProfessorQuestion = (value) => value.trim() || null;
`);
const UUID_STUB = toDataUrl(`
  export const normalizeUuid = (value) =>
    typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value.trim()) ? value.trim() : "";
`);
const QUESTION_SERVICE_STUB = toDataUrl(`
  export const createProfessorQuestionRecord = async (input) => {
    globalThis.__stage10QuestionCalls.push(input);
    return { ok: true, created: true, status: "pending", notificationDelivered: true };
  };
`);

let questionActionPromise;
function loadQuestionAction() {
  questionActionPromise ??= (async () => {
    let source = questionSource.replace('"use server";', "");
    source = source.replace(
      /import \{\s*normalizeQuestionCategory,\s*validateProfessorQuestion,\s*\} from "@\/lib\/professor-question-normalization";/,
      `import { normalizeQuestionCategory, validateProfessorQuestion } from ${JSON.stringify(NORMALIZATION_STUB)};`,
    );
    for (const [from, to] of [
      ['from "next/cache"', `from ${JSON.stringify(NEXT_CACHE_STUB)}`],
      ['from "@/lib/uuid"', `from ${JSON.stringify(UUID_STUB)}`],
      ['from "@/services/professor-questions.server"', `from ${JSON.stringify(QUESTION_SERVICE_STUB)}`],
    ]) {
      source = source.split(from).join(to);
    }
    const compiled = transpileModule(source, {
      compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 },
    }).outputText;
    assert.ok(!compiled.includes('from "@/'), "unrewritten alias import remains in question action");
    return import(toDataUrl(compiled));
  })();
  return questionActionPromise;
}

test("AI escalation persists the edited question through the professor workflow with an idempotency key", async () => {
  const courseId = "11111111-1111-4111-8111-111111111111";
  const submissionKey = "22222222-2222-4222-8222-222222222222";
  globalThis.__stage10QuestionCalls = [];
  globalThis.__stage10QuestionRevalidated = [];

  const { submitQuestionToProfessor } = await loadQuestionAction();
  const formData = new FormData();
  formData.set("courseId", courseId);
  formData.set("category", "수업 운영");
  formData.set("question", "Please explain the grading rule.");
  formData.set("submissionKey", submissionKey);
  formData.set("isAnonymous", "true");
  const result = await submitQuestionToProfessor(formData);

  assert.equal(result.ok, true);
  assert.deepEqual(globalThis.__stage10QuestionCalls, [{
    courseId,
    category: "수업 운영",
    question: "Please explain the grading rule.",
    submissionKey,
    sourceMessageId: null,
    sourceKind: "direct",
    isAnonymous: true,
  }]);
});

test("a direct professor question rejects a missing submissionKey before persistence", async () => {
  globalThis.__stage10QuestionCalls = [];
  globalThis.__stage10QuestionRevalidated = [];

  const { submitQuestionToProfessor } = await loadQuestionAction();
  const formData = new FormData();
  formData.set("courseId", "11111111-1111-4111-8111-111111111111");
  formData.set("category", "수업 운영");
  formData.set("question", "Please explain the grading rule.");

  const result = await submitQuestionToProfessor(formData);

  assert.deepEqual(result, { ok: false, message: "질문 정보를 확인해 주세요." });
  assert.deepEqual(globalThis.__stage10QuestionCalls, []);
  assert.deepEqual(globalThis.__stage10QuestionRevalidated, []);
});

test("assistant staff can read and answer pending professor questions", () => {
  assert.match(assistantMigration, /assistants read professor questions/);
  assert.match(assistantMigration, /p\.role in \('professor', 'assistant'\)/);
  assert.match(assistantMigration, /v_staff_role = 'assistant'/);
  assert.match(assistantMigration, /answered_by = v_staff_profile_id/);
});

test("tutor escalations support anonymous student delivery and a staff-answer notification", async () => {
  const workflowMigration = await readFile(
    new URL("../../supabase/migrations/20260714164021_tutor_question_rag_and_anonymity.sql", import.meta.url),
    "utf8",
  );
  assert.match(workflowMigration, /is_anonymous boolean not null default false/);
  assert.match(workflowMigration, /p_is_anonymous boolean/);
  assert.match(questionSource, /isAnonymous/);
  assert.match(questionSource, /revalidatePath\("\/dashboard"\)/);
});

test("course notices use the server admin client, validate ownership, and revalidate student feeds", () => {
  assert.match(noticeSource, /createSupabaseAdminClient/);
  assert.match(noticeSource, /course_professors/);
  assert.match(noticeSource, /course_offerings/);
  assert.match(noticeSource, /admin\.from\("posts"\)\.insert/);
  assert.match(noticeSource, /community_type:\s*"student"/);
  assert.match(noticeSource, /status:\s*"active"/);
  assert.match(noticeSource, /revalidatePath\("\/dashboard"\)/);
  assert.match(noticeSource, /revalidatePath\("\/notices"\)/);
  assert.match(noticeSource, /revalidatePath\("\/notifications"\)/);
  assert.match(noticeSource, /board_key: "course_notice"/g);
  assert.match(noticeSource, /category: "textbook"/);
  assert.match(noticeSource, /targetHref:\s*"\/notices"/);
  assert.match(noticeSource, /Course textbook admin client is unavailable/);
});
