import { createClient } from "@supabase/supabase-js";

// Codex round 5, F11. Two defects lived in the next twenty lines.
//
// 1. A literal newline sat inside the "Refusing to run" string, so this file
//    had NEVER parsed. The round-3 guard that referenced it matched its source
//    TEXT, which passes happily against a program the engine cannot compile.
// 2. The connection details were validated FIRST and by `throw`, so the
//    credential refusal below was unreachable without live credentials — the
//    fail-closed path could not be exercised, or even reached, in a check.
//
// Order is now: refuse for a missing credential table, then refuse for missing
// connection details, then connect. Both refusals are an explicit exit(1) with
// a message, so either can be observed without a live project.

// Codex F5: these passwords used to be hardcoded here AND published in the
// client bundle. They were rotated on 2026-08-14 and now live only in
// PACEMATE_DEMO_PASSWORDS, which is never committed. No credential in this file.
const demoPasswords = (() => {
  const raw = process.env.PACEMATE_DEMO_PASSWORDS;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
})();

if (!demoPasswords) {
  console.error(
    "Refusing to run: PACEMATE_DEMO_PASSWORDS is not set.\n" +
      "Demo credentials are no longer stored in the repository (Codex F5).",
  );
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  console.error(
    "Refusing to run: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.",
  );
  process.exit(1);
}

const supabase = createClient(url, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

const demoUsers = [
  { email: "assistant1@pacemate.edu", role: "assistant" },
  { email: "admin1@pacemate.edu", role: "admin" },
].map((user) => ({ ...user, password: demoPasswords[user.email] }));

const missing = demoUsers.filter((user) => !user.password).map((user) => user.email);
if (missing.length) {
  console.error(`Refusing to run: no credential supplied for ${missing.join(", ")}`);
  process.exit(1);
}

for (const demoUser of demoUsers) {
  const { data: listed, error: listError } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (listError) {
    throw listError;
  }

  let authUser = listed.users.find((user) => user.email === demoUser.email) ?? null;

  if (!authUser) {
    const { data: created, error: createError } = await supabase.auth.admin.createUser({
      email: demoUser.email,
      password: demoUser.password,
      email_confirm: true,
      user_metadata: {
        role: demoUser.role,
        source: "demo-seed",
      },
    });
    if (createError || !created.user) {
      throw createError ?? new Error(`Failed to create auth user for ${demoUser.email}`);
    }
    authUser = created.user;
  }

  const { error: profileError } = await supabase
    .from("profiles")
    .update({ auth_user_id: authUser.id })
    .eq("identifier", demoUser.email)
    .eq("role", demoUser.role)
    .or(`auth_user_id.is.null,auth_user_id.eq.${authUser.id}`);

  if (profileError) {
    throw profileError;
  }
}

console.log("Demo operator auth users are ready.");
