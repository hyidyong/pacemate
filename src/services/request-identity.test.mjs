import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Stage 3: the three dashboard card services each re-derived Supabase-Auth
// identity from scratch (3x auth.getUser network round trips + 3x profiles
// reads per render). They now share the request-scoped
// resolveAuthenticatedProfile; these tests freeze that wiring.

const cardServices = [
  "./company-law-offering.server.ts",
  "./course-term-completion-eligibility.server.ts",
  "./student-learning-recommendations.server.ts",
  "./professor-course-progress-report.server.ts",
  "./professor-anonymous-weekly-aggregate.server.ts",
  "./professor-questions.server.ts",
];

test("the identity resolver is request-scoped via React cache()", async () => {
  const source = await readFile(new URL("./request-identity.server.ts", import.meta.url), "utf8");
  assert.match(source, /import \{ cache \} from "react"/);
  assert.match(source, /export const resolveAuthenticatedProfile = cache\(/);
  assert.match(source, /auth\.getUser\(\)/, "the resolver owns the auth.getUser round trip");
});

for (const file of cardServices) {
  test(`${file.replace("./", "")} consumes the shared identity resolver`, async () => {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    assert.match(
      source,
      /resolveAuthenticatedProfile/,
      "card services must resolve identity through the shared request-scoped resolver",
    );
    assert.doesNotMatch(
      source,
      /auth\.getUser/,
      "a direct auth.getUser call re-introduces a per-service network round trip",
    );
  });
}
