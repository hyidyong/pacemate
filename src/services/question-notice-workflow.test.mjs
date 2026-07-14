import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const tutorSource = await readFile(new URL("./ai-tutor.actions.ts", import.meta.url), "utf8");
const questionSource = await readFile(new URL("./ask.actions.ts", import.meta.url), "utf8");
const noticeSource = await readFile(new URL("./course-settings.actions.ts", import.meta.url), "utf8");
const assistantMigration = await readFile(
  new URL("../../supabase/migrations/20260714134426_allow_assistant_question_workflow.sql", import.meta.url),
  "utf8",
);

test("AI escalation persists a user chat message and exposes its id to the handoff action", () => {
  assert.match(tutorSource, /from\("chat_messages"\)/);
  assert.match(tutorSource, /sourceMessageId/);
  assert.match(questionSource, /sourceKind: "tutor"/);
  assert.match(questionSource, /sourceMessageId/);
  assert.match(questionSource, /createProfessorQuestionRecord/);
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
