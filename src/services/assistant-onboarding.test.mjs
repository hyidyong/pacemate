import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { transpileModule, ModuleKind, ScriptTarget } = require("typescript");
const toDataUrl = (code) => `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;

const COOKIES_STUB = toDataUrl(
  "export const cookies = async () => globalThis.__stage10AssistantCookies;",
);
const CACHE_STUB = toDataUrl(
  "export const revalidatePath = (path) => globalThis.__stage10AssistantRevalidated.push(path);",
);
const NAVIGATION_STUB = toDataUrl(
  "export const redirect = (path) => { throw new Error(`REDIRECT:${path}`); };",
);
const ADMIN_STUB = toDataUrl(
  "export const createSupabaseAdminClient = () => globalThis.__stage10AssistantAdmin;",
);
const SESSION_STUB = toDataUrl(
  "export const readDemoSession = async () => globalThis.__stage10AssistantSession;",
);

let actionsPromise;
function loadActions() {
  actionsPromise ??= (async () => {
    let source = await readFile(new URL("./onboarding.actions.ts", import.meta.url), "utf8");
    for (const [from, to] of [
      ['"use server";', ""],
      ['from "next/headers"', `from ${JSON.stringify(COOKIES_STUB)}`],
      ['from "next/cache"', `from ${JSON.stringify(CACHE_STUB)}`],
      ['from "next/navigation"', `from ${JSON.stringify(NAVIGATION_STUB)}`],
      ['from "@/lib/supabase/admin"', `from ${JSON.stringify(ADMIN_STUB)}`],
      ['from "@/lib/auth/demo-session"', `from ${JSON.stringify(SESSION_STUB)}`],
    ]) {
      source = source.split(from).join(to);
    }
    const compiled = transpileModule(source, {
      compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 },
    }).outputText;
    assert.ok(!compiled.includes('from "@/'), "unrewritten alias import remains in onboarding action");
    return import(toDataUrl(compiled));
  })();
  return actionsPromise;
}

function setup(role) {
  const writes = [];
  globalThis.__stage10AssistantSession = { profileId: `${role}-profile`, role };
  globalThis.__stage10AssistantRevalidated = [];
  globalThis.__stage10AssistantCookies = {
    set(name, value, options) { writes.push({ name, value, options }); },
    delete() {},
  };
  globalThis.__stage10AssistantAdmin = { from() { throw new Error("unexpected database access"); } };
  return writes;
}

test("assistant onboarding accepts the signed assistant and stores only its workspace cookie", async () => {
  const writes = setup("assistant");
  const { saveAssistantOnboarding } = await loadActions();
  const formData = new FormData();
  formData.set("professorId", "assistant-lab-choice");

  await assert.rejects(saveAssistantOnboarding(formData), /REDIRECT:\/admin/);
  assert.deepEqual(writes, [{
    name: "pacemate_advising_professor_id",
    value: "assistant-lab-choice",
    options: { httpOnly: true, sameSite: "lax", path: "/" },
  }]);
  assert.deepEqual(globalThis.__stage10AssistantRevalidated, ["/onboarding", "/admin"]);
});

test("a student session cannot set the assistant workspace cookie", async () => {
  const writes = setup("student");
  const { saveAssistantOnboarding } = await loadActions();
  const formData = new FormData();
  formData.set("professorId", "assistant-lab-choice");

  await assert.rejects(saveAssistantOnboarding(formData), /REDIRECT:\/login/);
  assert.deepEqual(writes, []);
});
