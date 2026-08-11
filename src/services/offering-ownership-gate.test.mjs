import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const eligibilityServer = new URL("./course-term-completion-eligibility.server.ts", import.meta.url);
const recommendationsServer = new URL("./student-learning-recommendations.server.ts", import.meta.url);

// student_courses is unique on (student_id, course_id, status), so the same
// student+offering pair can legitimately appear on more than one row (e.g. an
// "interested" registration next to a "completed" row that the roadmap repair
// flow linked to the same offering). A bare .maybeSingle() errors on >1 row,
// which would break the dashboard card for exactly the students who own the
// offering twice — the ownership gate must bound the lookup the same way the
// roadmap server's authorization check does.

test("eligibility ownership gate accepts duplicate student_courses rows", async () => {
  const source = await readFile(eligibilityServer, "utf8");

  assert.match(
    source,
    /from\("student_courses"\)\s*\.select\("offering_id"\)\s*\.eq\("student_id", profileRow\.id\)\s*\.eq\("offering_id", normalizedOfferingId\)\s*\.limit\(1\)\s*\.maybeSingle\(\)/,
  );
});

test("recommendations ownership gate accepts duplicate student_courses rows", async () => {
  const source = await readFile(recommendationsServer, "utf8");

  assert.match(
    source,
    /from\("student_courses"\)\s*\.select\("offering_id"\)\s*\.eq\("student_id", profile\.id\)\s*\.eq\("offering_id", offeringId\)\s*\.limit\(1\)\s*\.maybeSingle\(\)/,
  );
});
