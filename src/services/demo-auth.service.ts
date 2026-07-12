"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  createDemoSession as createSignedDemoSession,
  destroyDemoSession,
} from "@/lib/auth/demo-session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getRoleHomePath, type DemoProfile } from "@/services/session.service";

function normalizeRequiredText(value: FormDataEntryValue | null, fallback = "") {
  const text = typeof value === "string" ? value.trim() : "";
  return text || fallback;
}

function isDemoProfileRole(value: unknown): value is DemoProfile["role"] {
  return (
    value === "student" ||
    value === "professor" ||
    value === "assistant" ||
    value === "admin"
  );
}

async function rejectLogin(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  errorCode: "invalid_password" | "read",
): Promise<never> {
  await supabase.auth.signOut().catch(() => undefined);
  await destroyDemoSession();
  redirect(`/login?error=${errorCode}`);
}

export async function createDemoSession(formData: FormData) {
  const cookieStore = await cookies();
  const identifier = normalizeRequiredText(formData.get("identifier"));
  const password = normalizeRequiredText(formData.get("password"));

  if (!identifier) {
    redirect("/login?error=identifier");
  }

  if (!password) {
    redirect("/login?error=password_required");
  }

  let supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  try {
    supabase = await createSupabaseServerClient();
  } catch {
    await destroyDemoSession();
    redirect("/login?error=read");
  }

  let authResult: Awaited<ReturnType<typeof supabase.auth.signInWithPassword>>;
  try {
    authResult = await supabase.auth.signInWithPassword({
      email: identifier,
      password,
    });
  } catch {
    return rejectLogin(supabase, "invalid_password");
  }

  if (authResult.error) {
    return rejectLogin(supabase, "invalid_password");
  }

  const authUser = authResult.data.user;
  if (!authUser) {
    return rejectLogin(supabase, "invalid_password");
  }
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, auth_user_id, role")
    .eq("auth_user_id", authUser.id)
    .maybeSingle();

  if (profileError || !profile) {
    return rejectLogin(supabase, "read");
  }

  if (profile.auth_user_id !== authUser.id || !isDemoProfileRole(profile.role)) {
    return rejectLogin(supabase, "read");
  }

  const role = profile.role;
  await createSignedDemoSession({ profileId: profile.id, role });

  await applyPendingOnboarding(
    supabase,
    profile.id,
    role,
    cookieStore.get("pacemate_pending_student_types")?.value,
  );
  cookieStore.delete("pacemate_pending_role");
  cookieStore.delete("pacemate_pending_student_types");

  if (role === "student") {
    const { data: studentData } = await supabase
      .from("student_profiles")
      .select("is_onboarded")
      .eq("profile_id", profile.id)
      .maybeSingle();

    if (!studentData?.is_onboarded) {
      redirect("/onboarding");
    }
  } else if (role === "assistant") {
    if (!cookieStore.get("pacemate_advising_professor_id")) {
      redirect("/onboarding?step=assistant-lab");
    }
  }

  redirect(getRoleHomePath(role));
}

export async function clearDemoSession() {
  const cookieStore = await cookies();

  try {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  } catch {
    // Always clear the compatibility cookie even if Auth sign-out is unavailable.
  }

  await destroyDemoSession();
  cookieStore.delete("pacemate_pending_role");
  cookieStore.delete("pacemate_pending_student_types");
  redirect("/login");
}

type StudentType =
  | "freshman"
  | "transfer"
  | "cross_major"
  | "double_major"
  | "current_student";

const allowedStudentTypes = new Set<StudentType>([
  "freshman",
  "transfer",
  "cross_major",
  "double_major",
  "current_student",
]);

function normalizePendingStudentTypes(value?: string) {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item): item is StudentType => allowedStudentTypes.has(item as StudentType));
}

async function applyPendingOnboarding(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  profileId: string,
  role: DemoProfile["role"],
  rawStudentTypes?: string,
) {
  if (role !== "student") return;

  const userTypes = normalizePendingStudentTypes(rawStudentTypes);
  if (!userTypes.length) return;

  await supabase.from("student_profiles").upsert(
    {
      profile_id: profileId,
      user_types: userTypes,
    },
    { onConflict: "profile_id" },
  );
}
