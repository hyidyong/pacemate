import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Stage 5 (matrix M9, KI-017): the student cancel control. Source guard in the
// repo's convention (see professor-workspace-feedback.test.mjs) — the action's
// behavior itself is covered in src/services/counseling.actions.test.mjs.

const componentUrl = new URL("./counseling-workspace.tsx", import.meta.url);

test("student requests panel offers cancel only for active (pending/approved) requests", async () => {
  const source = await readFile(componentUrl, "utf8");

  assert.match(
    source,
    /request\.status === "pending" \|\| request\.status === "approved"[\s\S]{0,400}?cancelRequest\(request\)/,
    "cancel control must be gated to active statuses",
  );
  assert.match(source, /상담 신청 취소/);
});

test("cancel asks for confirmation, funnels through runAction, and shares the pending guard", async () => {
  const source = await readFile(componentUrl, "utf8");

  assert.match(
    source,
    /function cancelRequest\(request[\s\S]*?window\.confirm\([\s\S]*?runAction\(cancelMyCounselingRequest,\s*formData,\s*"requests"\)/,
    "cancel must confirm first and report inline via the requests context",
  );
  assert.match(
    source,
    /disabled=\{isPending\}[\s\S]{0,200}?onClick=\{\(\) => cancelRequest\(request\)\}/,
    "cancel button must share the transition pending guard",
  );
});
