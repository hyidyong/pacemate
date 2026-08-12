import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { transpileModule, ModuleKind, ScriptTarget } = require("typescript");
import { readFile } from "node:fs/promises";

async function loadTenant() {
  const source = await readFile(new URL("./tenant.ts", import.meta.url), "utf8");
  const compiled = transpileModule(source, {
    compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
}

test("resolveTenantContext returns the profile's school as the tenant", async () => {
  const { resolveTenantContext } = await loadTenant();
  assert.deepEqual(
    resolveTenantContext({ school_id: "school-a" }),
    { tenantId: "school-a" },
  );
});

test("resolveTenantContext fails closed for a tenant-less profile", async () => {
  const { resolveTenantContext, TenantResolutionError } = await loadTenant();
  for (const bad of [null, { school_id: null }, { school_id: "" }]) {
    assert.throws(() => resolveTenantContext(bad), TenantResolutionError);
  }
});

test("tryResolveTenantContext degrades to null instead of throwing", async () => {
  const { tryResolveTenantContext } = await loadTenant();
  assert.equal(tryResolveTenantContext(null), null);
  assert.deepEqual(tryResolveTenantContext({ school_id: "s" }), { tenantId: "s" });
});

test("resolveTenantContext fails closed for a suspended school (Stage 7)", async () => {
  const { resolveTenantContext, TenantResolutionError } = await loadTenant();
  assert.throws(
    () => resolveTenantContext({ school_id: "school-a", school_status: "suspended" }),
    TenantResolutionError,
  );
});

test("resolveTenantContext still resolves when status is active or not carried", async () => {
  const { resolveTenantContext } = await loadTenant();
  // Stage 6 call sites do not fetch the school row — absence of status must
  // keep their behavior byte-compatible.
  assert.deepEqual(
    resolveTenantContext({ school_id: "school-a" }),
    { tenantId: "school-a" },
  );
  assert.deepEqual(
    resolveTenantContext({ school_id: "school-a", school_status: "active" }),
    { tenantId: "school-a" },
  );
});

test("tryResolveTenantContext degrades to null for a suspended school", async () => {
  const { tryResolveTenantContext } = await loadTenant();
  assert.equal(
    tryResolveTenantContext({ school_id: "school-a", school_status: "suspended" }),
    null,
  );
});
