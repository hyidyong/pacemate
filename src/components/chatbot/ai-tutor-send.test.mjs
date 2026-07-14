import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(new URL("./ai-tutor-chat.tsx", import.meta.url), "utf8");

test("AI tutor submits on regular Enter but preserves IME composition and Shift+Enter", () => {
  assert.match(source, /const submitMessage = async \(\) =>/);
  assert.match(source, /e\.nativeEvent\.isComposing/);
  assert.match(source, /e\.key === "Enter" && !e\.shiftKey/);
  assert.match(source, /void submitMessage\(\)/);
  assert.match(source, /onSubmit=\{handleSubmit\}/);
});
