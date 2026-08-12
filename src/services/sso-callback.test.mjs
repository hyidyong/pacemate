import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

// Stage 7 SSO callback boundary suite (TEST_MATRIX.md M-SSO-*). Drives the
// REAL processSsoCallback through the repo's transpile-loader convention
// against a deterministic TWO-TENANT fixture (University A / University B).
// Every deny asserts the redirect reason AND zero side effects (no session
// cookie issued, no rows written) — the tenant-isolation.test.mjs style.

const require = createRequire(import.meta.url);
const { transpileModule, ModuleKind, ScriptTarget } = require("typescript");

function toDataUrl(code) {
  return `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
}

const OBSERVABILITY_LOG_STUB = toDataUrl(
  "export const logEvent = () => {}; export const buildLogRecord = () => ({}); export const classifyPostgresError = () => 'fault';",
);
const REQUEST_CONTEXT_STUB = toDataUrl(
  "export const getRequestId = async () => undefined;",
);

const SERVER_STUB = toDataUrl(
  "export const createSupabaseServerClient = async () => globalThis.__ssoServerClient;",
);
const ADMIN_STUB = toDataUrl(
  "export const createSupabaseAdminClient = () => globalThis.__ssoAdminClient;",
);
const DEMO_SESSION_STUB = toDataUrl(
  `export const createDemoSession = async (claims) => { (globalThis.__ssoIssuedSessions ??= []).push(claims); };
   export const destroyDemoSession = async () => { globalThis.__ssoDestroyCount = (globalThis.__ssoDestroyCount ?? 0) + 1; };`,
);
const SESSION_SERVICE_STUB = toDataUrl(
  `export const getRoleHomePath = (role) =>
     role === "professor" ? "/professor" : role === "assistant" || role === "admin" ? "/admin" : "/dashboard";`,
);
const AUDIT_STUB = toDataUrl(
  `export const emitSsoAuditEvent = (event) => { (globalThis.__ssoAuditEvents ??= []).push(event); };
   export const hashSsoSubject = (ref, sub) => "h:" + ref + ":" + sub;`,
);

const registryUrl = new URL("../lib/sso/provider-registry.ts", import.meta.url).href;
const policyUrl = new URL("../lib/sso/sso-login-policy.ts", import.meta.url).href;
const tenantUrl = new URL("../lib/tenant.ts", import.meta.url).href;

let modulesPromise;
function loadModules() {
  modulesPromise ??= (async () => {
    let source = await readFile(new URL("./sso-callback.service.ts", import.meta.url), "utf8");
    for (const [from, to] of [
      ['import "server-only";', ""],
      ['from "@/lib/auth/demo-session"', `from ${JSON.stringify(DEMO_SESSION_STUB)}`],
      ['from "@/lib/sso/provider-registry"', `from ${JSON.stringify(registryUrl)}`],
      ['from "@/lib/sso/sso-audit"', `from ${JSON.stringify(AUDIT_STUB)}`],
      ['from "@/lib/sso/sso-login-policy"', `from ${JSON.stringify(policyUrl)}`],
      ['from "@/lib/tenant"', `from ${JSON.stringify(tenantUrl)}`],
      ['from "@/lib/supabase/admin"', `from ${JSON.stringify(ADMIN_STUB)}`],
      ['from "@/lib/supabase/server"', `from ${JSON.stringify(SERVER_STUB)}`],
      ['from "@/services/session.service"', `from ${JSON.stringify(SESSION_SERVICE_STUB)}`],
      ['from "@/lib/observability/log"', `from ${JSON.stringify(OBSERVABILITY_LOG_STUB)}`],
      ['from "@/lib/observability/request-context"', `from ${JSON.stringify(REQUEST_CONTEXT_STUB)}`],
    ]) {
      source = source.split(from).join(to);
    }
    const compiled = transpileModule(source, {
      compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 },
    }).outputText;
    assert.ok(!compiled.includes('from "@/'), "unrewritten alias import in sso-callback.service.ts");
    return import(toDataUrl(compiled));
  })();
  return modulesPromise;
}

// ---- Two-tenant fixture -----------------------------------------------------

const SCHOOL_A = "school-a";
const SCHOOL_B = "school-b";

const REGISTRY = JSON.stringify([
  {
    schoolId: SCHOOL_A,
    slug: "univ-a",
    protocol: "oidc",
    providerRef: "custom:univ-a",
    issuer: "https://idp.univ-a.test",
    emailDomains: ["univ-a.test"],
    enabled: true,
    policy: {
      jit: { enabled: false, allowedRoles: [], requireEmailVerified: true, requireDomains: [] },
      enforceSsoOnly: false,
    },
  },
  {
    schoolId: SCHOOL_B,
    slug: "univ-b",
    protocol: "oidc",
    providerRef: "custom:univ-b",
    issuer: "https://idp.univ-b.test",
    emailDomains: ["univ-b.test"],
    enabled: true,
    policy: {
      jit: { enabled: false, allowedRoles: [], requireEmailVerified: true, requireDomains: [] },
      enforceSsoOnly: false,
    },
  },
]);

const REGISTRY_WITH_A_JIT = JSON.stringify([
  {
    ...JSON.parse(REGISTRY)[0],
    policy: {
      jit: {
        enabled: true,
        allowedRoles: ["student"],
        requireEmailVerified: true,
        requireDomains: ["univ-a.test"],
      },
      enforceSsoOnly: false,
    },
  },
  JSON.parse(REGISTRY)[1],
]);

function makeAuthUser({ id, provider, sub, email, emailVerified = true, affiliation = "student", name = "가나다" }) {
  return {
    id,
    email,
    identities: [
      {
        id: sub,
        provider,
        identity_data: {
          sub,
          email,
          email_verified: emailVerified,
          affiliation,
          name,
        },
      },
    ],
  };
}

function makeFakeServerClient({ user, validCodes }) {
  const consumed = new Set();
  const state = { signOutCount: 0 };
  return {
    state,
    auth: {
      exchangeCodeForSession: async (code) => {
        if (!validCodes.includes(code) || consumed.has(code)) {
          return { data: null, error: { message: "invalid or replayed code" } };
        }
        consumed.add(code);
        return { data: {}, error: null };
      },
      getUser: async () => ({ data: { user }, error: null }),
      signOut: async () => {
        state.signOutCount += 1;
      },
    },
  };
}

function makeFakeAdminDb(fixtures) {
  const state = {
    fixtures: structuredClone(fixtures),
    updates: [],
    inserts: [],
    failNextUpdate: false,
  };

  function from(table) {
    const builder = {
      _op: "select",
      _filters: [],
      _values: null,
      select() {
        return builder;
      },
      eq(col, val) {
        builder._filters.push({ kind: "eq", col, val });
        return builder;
      },
      is(col, val) {
        builder._filters.push({ kind: "is", col, val });
        return builder;
      },
      ilike(col, val) {
        builder._filters.push({ kind: "ilike", col, val });
        return builder;
      },
      update(values) {
        builder._op = "update";
        builder._values = values;
        return builder;
      },
      insert(values) {
        builder._op = "insert";
        builder._values = values;
        return builder;
      },
      async maybeSingle() {
        const rows = state.fixtures[table] ?? [];
        const matches = () =>
          rows.filter((row) =>
            builder._filters.every((f) => {
              if (f.kind === "eq") return row[f.col] === f.val;
              if (f.kind === "is") return f.val === null ? row[f.col] == null : row[f.col] === f.val;
              return String(row[f.col] ?? "").toLowerCase() === String(f.val).toLowerCase();
            }),
          );

        if (builder._op === "insert") {
          const values = builder._values;
          if (
            table === "profiles" &&
            rows.some(
              (row) =>
                String(row.identifier ?? "").toLowerCase() ===
                String(values.identifier ?? "").toLowerCase(),
            )
          ) {
            // profiles.identifier is GLOBALLY unique — model the conflict.
            return { data: null, error: { code: "23505", message: "duplicate identifier" } };
          }
          const created = { id: `created-${rows.length + 1}`, ...values };
          rows.push(created);
          state.inserts.push({ table, values: created });
          return { data: created, error: null };
        }

        if (builder._op === "update") {
          if (state.failNextUpdate) {
            state.failNextUpdate = false;
            return { data: null, error: null }; // CAS matched 0 rows
          }
          const targets = matches();
          for (const row of targets) Object.assign(row, builder._values);
          state.updates.push({ table, values: builder._values, matched: targets.length });
          return { data: targets[0] ?? null, error: null };
        }

        const found = matches();
        return { data: found[0] ?? null, error: null };
      },
    };
    return builder;
  }

  return { state, from };
}

const BASE_FIXTURES = {
  profiles: [
    {
      id: "profile-a",
      identifier: "member@univ-a.test",
      role: "student",
      school_id: SCHOOL_A,
      auth_user_id: "auth-linked-a",
    },
    {
      id: "profile-b",
      identifier: "member@univ-b.test",
      role: "student",
      school_id: SCHOOL_B,
      auth_user_id: "auth-linked-b",
    },
    {
      id: "profile-a-unlinked",
      identifier: "fresh@univ-a.test",
      role: "professor",
      school_id: SCHOOL_A,
      auth_user_id: null,
    },
  ],
  schools: [
    { id: SCHOOL_A, status: "active" },
    { id: SCHOOL_B, status: "active" },
  ],
};

async function runCallback({ user, fixtures = BASE_FIXTURES, registry = REGISTRY, codes = ["code-1"], code = "code-1" }) {
  const { processSsoCallback } = await loadModules();
  const server = makeFakeServerClient({ user, validCodes: codes });
  const admin = makeFakeAdminDb(fixtures);
  globalThis.__ssoServerClient = server;
  globalThis.__ssoAdminClient = admin;
  globalThis.__ssoIssuedSessions = [];
  globalThis.__ssoAuditEvents = [];
  globalThis.__ssoDestroyCount = 0;
  process.env.PACEMATE_SSO_PROVIDERS = registry;
  try {
    const result = await processSsoCallback(code);
    return {
      result,
      server,
      admin,
      sessions: globalThis.__ssoIssuedSessions,
      audits: globalThis.__ssoAuditEvents,
      destroyCount: globalThis.__ssoDestroyCount,
    };
  } finally {
    delete globalThis.__ssoServerClient;
    delete globalThis.__ssoAdminClient;
    delete globalThis.__ssoIssuedSessions;
    delete globalThis.__ssoAuditEvents;
    delete globalThis.__ssoDestroyCount;
    delete process.env.PACEMATE_SSO_PROVIDERS;
  }
}

function assertDenied(run, reason) {
  assert.deepEqual(run.result, { ok: false, redirectTo: `/login?error=sso_${reason}` });
  assert.equal(run.sessions.length, 0, "no app session may be issued on a deny");
  assert.equal(run.admin.state.inserts.length, 0, "no rows may be inserted on a deny");
  assert.equal(run.admin.state.updates.length, 0, "no rows may be updated on a deny");
  assert.ok(run.server.state.signOutCount >= 1, "the half-built GoTrue session must be discarded");
  assert.ok(run.destroyCount >= 1, "any stale app cookie must be destroyed");
  assert.deepEqual(
    run.audits.map((event) => event.event),
    ["sso_login_denied"],
  );
  assert.equal(run.audits[0].reason, reason);
}

// ---- M-SSO-1: valid A member via A provider → allow -------------------------

test("M-SSO-1: valid University A member through A's provider → session issued for the A membership", async () => {
  const run = await runCallback({
    user: makeAuthUser({
      id: "auth-linked-a",
      provider: "custom:univ-a",
      sub: "sub-a",
      email: "member@univ-a.test",
    }),
  });
  assert.deepEqual(run.result, { ok: true, redirectTo: "/dashboard" });
  assert.deepEqual(run.sessions, [{ profileId: "profile-a", role: "student" }]);
  assert.equal(run.server.state.signOutCount, 0);
  assert.deepEqual(run.audits.map((event) => event.event), ["sso_login_ok"]);
  assert.equal(run.admin.state.inserts.length, 0);
});

// ---- M-SSO-2: A identity, B membership → cross-tenant deny ------------------

test("M-SSO-2: University A's IdP cannot mint a session for a University B membership", async () => {
  const run = await runCallback({
    user: makeAuthUser({
      id: "auth-linked-b", // resolves to the B profile
      provider: "custom:univ-a", // asserted by A's IdP
      sub: "sub-cross",
      email: "member@univ-b.test",
    }),
  });
  assertDenied(run, "tenant_mismatch");
});

// ---- M-SSO-3: unknown provider ---------------------------------------------

test("M-SSO-3: an identity from an unregistered provider is denied", async () => {
  const run = await runCallback({
    user: makeAuthUser({
      id: "auth-linked-a",
      provider: "custom:unknown-univ",
      sub: "sub-a",
      email: "member@univ-a.test",
    }),
  });
  assertDenied(run, "unknown_provider");
});

// ---- M-SSO-4: invalid callback code ----------------------------------------

test("M-SSO-4: an invalid authorization code is a controlled deny", async () => {
  const run = await runCallback({
    user: makeAuthUser({
      id: "auth-linked-a",
      provider: "custom:univ-a",
      sub: "sub-a",
      email: "member@univ-a.test",
    }),
    code: "forged-code",
  });
  assertDenied(run, "failed");
});

// ---- M-SSO-5: missing required claim ---------------------------------------

test("M-SSO-5: an assertion without a stable subject is a controlled failure", async () => {
  const user = makeAuthUser({
    id: "auth-linked-a",
    provider: "custom:univ-a",
    sub: "sub-a",
    email: "member@univ-a.test",
  });
  user.identities[0].id = "";
  delete user.identities[0].identity_data.sub;
  const run = await runCallback({ user });
  assertDenied(run, "missing_required_claim");
});

// ---- M-SSO-6: account linking of a pre-provisioned profile ------------------

test("M-SSO-6: first SSO login links the pre-provisioned profile once (CAS) and reuses its role", async () => {
  const run = await runCallback({
    user: makeAuthUser({
      id: "auth-new-prof",
      provider: "custom:univ-a",
      sub: "sub-prof",
      email: "fresh@univ-a.test",
      affiliation: "faculty",
    }),
  });
  assert.deepEqual(run.result, { ok: true, redirectTo: "/professor" });
  assert.deepEqual(run.sessions, [{ profileId: "profile-a-unlinked", role: "professor" }]);
  assert.deepEqual(
    run.admin.state.updates,
    [{ table: "profiles", values: { auth_user_id: "auth-new-prof" }, matched: 1 }],
  );
  assert.deepEqual(
    run.audits.map((event) => event.event),
    ["sso_account_linked", "sso_login_ok"],
  );
});

test("M-SSO-6b: a lost linking race (CAS matches 0 rows) denies with identity_conflict", async () => {
  const { processSsoCallback } = await loadModules();
  const server = makeFakeServerClient({
    user: makeAuthUser({
      id: "auth-new-prof",
      provider: "custom:univ-a",
      sub: "sub-prof",
      email: "fresh@univ-a.test",
    }),
    validCodes: ["code-1"],
  });
  const admin = makeFakeAdminDb(BASE_FIXTURES);
  admin.state.failNextUpdate = true;
  globalThis.__ssoServerClient = server;
  globalThis.__ssoAdminClient = admin;
  globalThis.__ssoIssuedSessions = [];
  globalThis.__ssoAuditEvents = [];
  globalThis.__ssoDestroyCount = 0;
  process.env.PACEMATE_SSO_PROVIDERS = REGISTRY;
  try {
    const result = await processSsoCallback("code-1");
    assert.deepEqual(result, { ok: false, redirectTo: "/login?error=sso_identity_conflict" });
    assert.equal(globalThis.__ssoIssuedSessions.length, 0);
  } finally {
    delete globalThis.__ssoServerClient;
    delete globalThis.__ssoAdminClient;
    delete globalThis.__ssoIssuedSessions;
    delete globalThis.__ssoAuditEvents;
    delete globalThis.__ssoDestroyCount;
    delete process.env.PACEMATE_SSO_PROVIDERS;
  }
});

// ---- M-SSO-7: unknown user, JIT off vs on ----------------------------------

test("M-SSO-7a: unknown user with JIT off (default) → not_provisioned, nothing created", async () => {
  const run = await runCallback({
    user: makeAuthUser({
      id: "auth-stranger",
      provider: "custom:univ-a",
      sub: "sub-stranger",
      email: "stranger@univ-a.test",
    }),
  });
  assertDenied(run, "not_provisioned");
});

test("M-SSO-7b: unknown student with JIT enabled → provisioned as student in the provider's tenant", async () => {
  const run = await runCallback({
    user: makeAuthUser({
      id: "auth-stranger",
      provider: "custom:univ-a",
      sub: "sub-stranger",
      email: "stranger@univ-a.test",
    }),
    registry: REGISTRY_WITH_A_JIT,
  });
  assert.deepEqual(run.result, { ok: true, redirectTo: "/dashboard" });
  assert.equal(run.admin.state.inserts.length, 1);
  const created = run.admin.state.inserts[0].values;
  assert.equal(created.role, "student");
  assert.equal(created.school_id, SCHOOL_A);
  assert.equal(created.auth_user_id, "auth-stranger");
  assert.deepEqual(
    run.audits.map((event) => event.event),
    ["sso_jit_provisioned", "sso_login_ok"],
  );
});

// ---- M-SSO-8: privileged claims never escalate ------------------------------

test("M-SSO-8: a privileged affiliation claim never JIT-provisions (no auto-escalation)", async () => {
  for (const affiliation of ["admin", "faculty", "staff"]) {
    const run = await runCallback({
      user: makeAuthUser({
        id: "auth-stranger",
        provider: "custom:univ-a",
        sub: "sub-stranger",
        email: "stranger@univ-a.test",
        affiliation,
      }),
      registry: REGISTRY_WITH_A_JIT,
    });
    assertDenied(run, "role_not_allowed");
  }
});

// ---- M-SSO-9: revoked membership -------------------------------------------

test("M-SSO-9: an identity whose membership was removed is denied (deny-unmapped)", async () => {
  const fixtures = structuredClone(BASE_FIXTURES);
  fixtures.profiles = fixtures.profiles.filter((profile) => profile.id !== "profile-a");
  const run = await runCallback({
    user: makeAuthUser({
      id: "auth-linked-a",
      provider: "custom:univ-a",
      sub: "sub-a",
      email: "member@univ-a.test",
    }),
    fixtures,
  });
  // The pre-provisioned email also no longer exists, so no linking candidate:
  // the identity has no membership and JIT is off.
  assertDenied(run, "not_provisioned");
});

// ---- M-SSO-10: suspended tenant --------------------------------------------

test("M-SSO-10: a suspended tenant denies every SSO login", async () => {
  const fixtures = structuredClone(BASE_FIXTURES);
  fixtures.schools = fixtures.schools.map((school) =>
    school.id === SCHOOL_A ? { ...school, status: "suspended" } : school,
  );
  const run = await runCallback({
    user: makeAuthUser({
      id: "auth-linked-a",
      provider: "custom:univ-a",
      sub: "sub-a",
      email: "member@univ-a.test",
    }),
    fixtures,
  });
  assertDenied(run, "school_suspended");
});

// ---- M-SSO-11: callback replay ---------------------------------------------

test("M-SSO-11: a duplicate callback with a consumed code cannot mint a second session", async () => {
  const { processSsoCallback } = await loadModules();
  const user = makeAuthUser({
    id: "auth-linked-a",
    provider: "custom:univ-a",
    sub: "sub-a",
    email: "member@univ-a.test",
  });
  const server = makeFakeServerClient({ user, validCodes: ["code-1"] });
  const admin = makeFakeAdminDb(BASE_FIXTURES);
  globalThis.__ssoServerClient = server;
  globalThis.__ssoAdminClient = admin;
  globalThis.__ssoIssuedSessions = [];
  globalThis.__ssoAuditEvents = [];
  globalThis.__ssoDestroyCount = 0;
  process.env.PACEMATE_SSO_PROVIDERS = REGISTRY;
  try {
    const first = await processSsoCallback("code-1");
    const replay = await processSsoCallback("code-1");
    assert.equal(first.ok, true);
    assert.deepEqual(replay, { ok: false, redirectTo: "/login?error=sso_failed" });
    assert.equal(globalThis.__ssoIssuedSessions.length, 1, "replay must not issue a second session");
  } finally {
    delete globalThis.__ssoServerClient;
    delete globalThis.__ssoAdminClient;
    delete globalThis.__ssoIssuedSessions;
    delete globalThis.__ssoAuditEvents;
    delete globalThis.__ssoDestroyCount;
    delete process.env.PACEMATE_SSO_PROVIDERS;
  }
});

// ---- Password-only users and broken registries ------------------------------

test("a password-only auth user (no external identity) is denied at the SSO callback", async () => {
  const run = await runCallback({
    user: {
      id: "auth-linked-a",
      email: "member@univ-a.test",
      identities: [{ id: "auth-linked-a", provider: "email", identity_data: {} }],
    },
  });
  assertDenied(run, "failed");
});

test("a malformed provider registry fails closed: every SSO login denies", async () => {
  const run = await runCallback({
    user: makeAuthUser({
      id: "auth-linked-a",
      provider: "custom:univ-a",
      sub: "sub-a",
      email: "member@univ-a.test",
    }),
    registry: "not-json",
  });
  assertDenied(run, "unknown_provider");
});

test("a JIT identifier collision with another tenant's handle denies instead of merging", async () => {
  const fixtures = structuredClone(BASE_FIXTURES);
  // profiles.identifier is GLOBALLY unique: a University B member already owns
  // this handle (already linked, so it is no linking candidate). The A-side
  // JIT insert must surface the conflict and deny — never merge identities.
  fixtures.profiles.push({
    id: "profile-b2",
    identifier: "taken@univ-a.test",
    role: "student",
    school_id: SCHOOL_B,
    auth_user_id: "auth-linked-b2",
  });
  const run = await runCallback({
    user: makeAuthUser({
      id: "auth-stranger",
      provider: "custom:univ-a",
      sub: "sub-stranger",
      email: "taken@univ-a.test",
    }),
    fixtures,
    registry: REGISTRY_WITH_A_JIT,
  });
  assert.deepEqual(run.result, { ok: false, redirectTo: "/login?error=sso_identity_conflict" });
  assert.equal(run.sessions.length, 0);
  assert.equal(run.admin.state.inserts.length, 0);
});
