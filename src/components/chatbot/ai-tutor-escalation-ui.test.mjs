import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(new URL("./ai-tutor-chat.tsx", import.meta.url), "utf8");

test("AI tutor hands an editable prefilled question to the professor request action", () => {
  assert.match(source, /submitQuestionToProfessor/);
  assert.match(source, /editingEscalationId/);
  assert.match(source, /defaultValue|value=\{escalationDraft\}/);
  assert.match(source, /formData\.set\("question", escalationDraft\)/);
  assert.match(source, /escalationSubmissionKeys\.current\.get\(message\.id\) \?\? crypto\.randomUUID\(\)/);
  assert.match(source, /formData\.set\("submissionKey", submissionKey\)/);
  assert.doesNotMatch(source, /false && m\.isEscalated/);
});

test("AI tutor displays retrieved source labels without borders", () => {
  assert.match(source, /sources\?: TutorCitation\[\]/);
  assert.match(source, /출처:/);
  assert.doesNotMatch(source, /border[^\n]*출처/);
});
