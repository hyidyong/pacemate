import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Stage 4 T1 (audit B-1): every professor server action already returns
// { ok, message }, but the workspace's shared runAction ignored `ok` — it
// rendered failures with the success toast styling AND ran afterSuccess()
// unconditionally, so a failed approve/reject removed the request card from
// the pending queue anyway. These tests freeze the ok-branching contract.

const workspaceSource = () =>
  readFile(new URL("./professor-workspace.tsx", import.meta.url), "utf8");

test("runAction types server action results with an ok flag", async () => {
  const source = await workspaceSource();

  assert.match(
    source,
    /action:\s*\(formData:\s*FormData\)\s*=>\s*Promise<\{\s*ok:\s*boolean;\s*message:\s*string\s*\}>/,
    "runAction must type action results as { ok: boolean; message: string } so failures are distinguishable",
  );
});

test("runAction only runs afterSuccess when the action reports ok", async () => {
  const source = await workspaceSource();

  assert.match(
    source,
    /if\s*\(result\.ok\)\s*\{\s*afterSuccess\?\.\(\);/,
    "afterSuccess (queue mutation) must be gated on result.ok — a failed approve/reject must not remove the card",
  );
});

test("toast rendering distinguishes failure from success", async () => {
  const source = await workspaceSource();

  assert.match(
    source,
    /showToast\(result\.message,\s*result\.ok\)/,
    "the toast must carry the ok flag so failures are not rendered as green successes",
  );
  assert.match(
    source,
    /role="status"/,
    "the toast container needs a live region so results are announced",
  );
});
