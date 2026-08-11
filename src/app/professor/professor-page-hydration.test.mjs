import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// KI-013: the professor workspace intermittently never left the "워크스페이스
// 불러오는 중..." fallback. The seam was a next/dynamic() wrapper in the Server
// Component page — the workspace chunk is eagerly preloaded for /professor
// anyway (app-build-manifest), so the wrapper deferred nothing and only added
// the flaky Suspense/lazy hydration boundary. These tests freeze the fix.

test("professor page imports the workspace statically (no next/dynamic hydration seam)", async () => {
  const source = await readFile(new URL("./page.tsx", import.meta.url), "utf8");

  assert.doesNotMatch(
    source,
    /next\/dynamic/,
    "professor/page.tsx must not reintroduce next/dynamic — the KI-013 stuck-fallback seam",
  );
  assert.match(
    source,
    /import\s*\{\s*ProfessorWorkspace\s*\}\s*from\s*"@\/components\/professor\/professor-workspace"/,
    "professor/page.tsx must import ProfessorWorkspace statically",
  );
});

test("professor workspace does not nest a second <main> inside the app shell main", async () => {
  const source = await readFile(
    new URL("../../components/professor/professor-workspace.tsx", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(
    source,
    /<main[\s>]/,
    "professor-workspace renders inside AppShell's <main>; a nested <main> is invalid HTML and hydration-hostile",
  );
});

test("professor workspace uses the statically imported counseling status action", async () => {
  const source = await readFile(
    new URL("../../components/professor/professor-workspace.tsx", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(
    source,
    /import\("@\/services\/professor\.actions"\)/,
    "professor.actions is statically imported at the top of the file; the inline dynamic import only added a chunk fetch inside a user action",
  );
});
