import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

// Stage 7 SSO wiring guards — freeze the security-relevant source shape (the
// request-memoization.test.mjs / session-performance.test.mjs idiom):
// tenant/role never come from the request, the decision precedes session
// issuance, secrets/tokens are never logged, and the mock IdP stays test-only.

const root = new URL("../..", import.meta.url); // -> <repo>/src/..

async function readSource(relative) {
  return readFile(new URL(relative, root), "utf8");
}

test("callback route consumes ONLY the one-time code — never tenant/role/redirect inputs", async () => {
  const source = await readSource("src/app/auth/callback/route.ts");
  const paramReads = [...source.matchAll(/searchParams\.get\("([^"]+)"\)/g)].map(
    (match) => match[1],
  );
  assert.deepEqual(paramReads, ["code"], "the callback may read no query input besides code");
  assert.doesNotMatch(source, /cookies\(\)|request\.cookies|\.json\(\)|formData/, "no other request inputs");
  assert.match(source, /processSsoCallback\(code\)/);
});

test("SSO initiation route treats the slug as routing only and never as authorization", async () => {
  const source = await readSource("src/app/login/sso/[slug]/route.ts");
  assert.match(source, /findSsoProviderBySlug/);
  assert.doesNotMatch(source, /searchParams\.get/, "initiation reads no query params");
  assert.doesNotMatch(source, /createDemoSession|issueAppSessionCookie/, "initiation never mints a session");
});

test("the callback service decides BEFORE it issues the app session, via the pure policy", async () => {
  const source = await readSource("src/services/sso-callback.service.ts");
  const decisionIndex = source.indexOf("evaluateSsoLogin(");
  const tenantGuardIndex = source.indexOf("resolveTenantContext(");
  const issueIndex = source.indexOf("await issueAppSessionCookie(");
  assert.ok(decisionIndex > 0 && issueIndex > 0 && tenantGuardIndex > 0);
  assert.ok(decisionIndex < issueIndex, "the login decision must precede session issuance");
  assert.ok(tenantGuardIndex < issueIndex, "the Stage 6 tenant chokepoint must precede session issuance");
});

test("the callback service never logs codes, tokens, claims, or emails", async () => {
  const source = await readSource("src/services/sso-callback.service.ts");
  const consoleCalls = source.match(/console\.\w+\(/g) ?? [];
  assert.deepEqual(
    consoleCalls,
    ["console.warn("],
    "exactly one console call (the registry rejection warning) is allowed",
  );
  // The single allowed console call is the registry-rejection warning, which
  // logs only the parse error message — no request or identity material.
  assert.match(source, /console\.warn\(\s*"\[sso\] provider registry rejected/);
  // Structured audit goes through the allowlisted emitter only.
  assert.match(source, /emitSsoAuditEvent\(/);
});

test("the audit emitter allowlist never carries tokens/emails/claims fields", async () => {
  const source = await readSource("src/lib/sso/sso-audit.ts");
  assert.match(source, /ALLOWED_FIELDS/);
  assert.doesNotMatch(source, /"(email|token|code|claims|name)"/);
});

test("the provider registry stays pure: no env reads, no secret fields tolerated", async () => {
  const source = await readSource("src/lib/sso/provider-registry.ts");
  assert.doesNotMatch(source, /process\.env/, "env access belongs to the server boundary only");
  assert.match(source, /SECRET_KEY_PATTERN/, "structural secret rejection must stay");
});

test("the mock IdP is imported by no application module (test-only, structural)", async () => {
  const srcRoot = new URL("src/", root);
  const entries = await readdir(srcRoot, { recursive: true });
  const offenders = [];
  for (const entry of entries) {
    if (!/\.(ts|tsx)$/.test(entry)) continue;
    const normalized = entry.split(path.sep).join("/");
    if (normalized === "lib/sso/mock-idp.ts") continue;
    const source = await readFile(new URL(normalized, srcRoot), "utf8");
    if (/from\s+["'][^"']*mock-idp["']/.test(source)) {
      offenders.push(normalized);
    }
  }
  assert.deepEqual(offenders, [], "no app module may import the mock IdP");
});

test("the legacy password login path is untouched by Stage 7 (bridge, not replacement)", async () => {
  const source = await readSource("src/services/demo-auth.service.ts");
  assert.match(source, /signInWithPassword/);
  assert.doesNotMatch(
    source,
    /processSsoCallback|sso-login-policy|provider-registry|signInWithSSO|signInWithOAuth/,
    "legacy password login must not grow SSO wiring this stage",
  );
});
