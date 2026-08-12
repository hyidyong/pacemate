import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { transpileModule, ModuleKind, ScriptTarget } = require("typescript");

// Stage 3 query-count guard (deterministic proxy — no wall-clock): /mypage's
// getMyPageData used to execute the posts + post_reactions + comments working
// set once per helper (my/scraped/liked/commented = 4x). This suite pins the
// posts feed to exactly ONE fetch per render while freezing the four derived
// views' semantics.

function stubModule(source) {
  return `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
}

const SERVER_STUB = stubModule(
  "export const createSupabaseServerClient = async () => globalThis.__stage3FakeSupabase;",
);
const ADMIN_STUB = stubModule(
  "export const createSupabaseAdminClient = () => globalThis.__stage3FakeSupabase;",
);
const TIMETABLE_SCHEMA_STUB = stubModule(
  "export const isMissingTimetableSchema = () => false;",
);

async function loadStudentCommunityService() {
  const source = await readFile(new URL("./student-community.service.ts", import.meta.url), "utf8");
  const rewritten = source
    .replace('import "server-only";', "")
    .replace('from "@/lib/supabase/server"', `from ${JSON.stringify(SERVER_STUB)}`)
    .replace('from "@/lib/supabase/admin"', `from ${JSON.stringify(ADMIN_STUB)}`)
    .replace('from "@/lib/student-timetable-schema"', `from ${JSON.stringify(TIMETABLE_SCHEMA_STUB)}`);
  const compiled = transpileModule(rewritten, {
    compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
}

function makeFakeSupabase(fixtures) {
  const counts = {};
  function makeBuilder(table) {
    const rows = fixtures[table] ?? [];
    const builder = {
      select: () => builder,
      eq: () => builder,
      in: () => builder,
      or: () => builder,
      order: () => builder,
      limit: () => builder,
      update: () => builder,
      maybeSingle: () => ({
        then: (resolve) => resolve({ data: null, error: null }),
      }),
      then: (resolve) => resolve({ data: rows, error: null, count: rows.length }),
    };
    return builder;
  }
  return {
    counts,
    from(table) {
      counts[table] = (counts[table] ?? 0) + 1;
      return makeBuilder(table);
    },
  };
}

const profile = {
  id: "p1",
  identifier: "student1@pacemate.edu",
  name: "김학생",
  role: "student",
  school_id: "s1",
  department_id: null,
};

const post = {
  id: "post1",
  author_id: "p1",
  category: "free",
  board_key: "free",
  title: "제목",
  content: "본문",
  course_id: null,
  school_id: "s1",
  display_mode: "named",
  anonymous_alias: null,
  view_count: 0,
  is_resolved: false,
  created_at: "2026-08-01T00:00:00Z",
  course: null,
  author: { id: "p1", name: "김학생", role: "student" },
};

const fixtures = {
  posts: [post],
  post_reactions: [
    { post_id: "post1", user_id: "p1", type: "scrap" },
    { post_id: "post1", user_id: "p1", type: "like" },
  ],
  comments: [{ post_id: "post1", author_id: "p1" }],
};

test("getMyPageData fetches the community posts feed exactly once", async () => {
  const service = await loadStudentCommunityService();
  const fake = makeFakeSupabase(fixtures);
  globalThis.__stage3FakeSupabase = fake;
  try {
    await service.getMyPageData(profile);
  } finally {
    delete globalThis.__stage3FakeSupabase;
  }

  assert.equal(
    fake.counts.posts ?? 0,
    1,
    `the 80-post feed must be fetched once per render, not once per derived view (got ${fake.counts.posts})`,
  );
});

test("the four derived post views keep their semantics from the shared feed", async () => {
  const service = await loadStudentCommunityService();
  const fake = makeFakeSupabase(fixtures);
  globalThis.__stage3FakeSupabase = fake;
  let data;
  try {
    data = await service.getMyPageData(profile);
  } finally {
    delete globalThis.__stage3FakeSupabase;
  }

  for (const key of ["myPosts", "scrapedPosts", "commentedPosts", "likedPosts"]) {
    assert.equal(data[key].length, 1, `${key} should contain the fixture post`);
    assert.equal(data[key][0].id, "post1");
  }
  const enriched = data.myPosts[0];
  assert.equal(enriched.likes, 1);
  assert.equal(enriched.scraps, 1);
  assert.equal(enriched.comments, 1);
  assert.equal(enriched.is_liked, true);
  assert.equal(enriched.is_scrapped, true);
});
