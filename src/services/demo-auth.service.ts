"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { getRoleHomePath } from "@/services/session.service";
import crypto from "crypto";

const roleLabels = {
  student: "학생",
  professor: "교수",
  assistant: "조교",
  admin: "관리자",
} as const;

type DemoRole = keyof typeof roleLabels;
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

const adminLoginKey = process.env.PACEMATE_ADMIN_LOGIN_KEY ?? "PACEMATE-ADMIN-2026";

function normalizeRole(value: FormDataEntryValue | null): DemoRole {
  if (
    value === "student" ||
    value === "professor" ||
    value === "assistant" ||
    value === "admin"
  ) {
    return value;
  }

  return "student";
}

function normalizeRequiredText(value: FormDataEntryValue | null, fallback = "") {
  const text = typeof value === "string" ? value.trim() : "";
  return text || fallback;
}

function normalizePendingStudentTypes(value?: string) {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item): item is StudentType => allowedStudentTypes.has(item as StudentType));
}

function hashPassword(password: string) {
  return crypto.createHash("sha256").update(password).digest("hex");
}

export async function createDemoSession(formData: FormData) {
  const cookieStore = await cookies();
  const pendingRole = cookieStore.get("pacemate_pending_role")?.value;
  const role = normalizeRole(formData.get("role") || pendingRole || null);
  const adminKey = normalizeRequiredText(formData.get("adminKey"));
  const identifier =
    role === "admin" ? "pacemate-admin" : normalizeRequiredText(formData.get("identifier"));
  const name =
    role === "admin"
      ? "관리자"
      : normalizeRequiredText(formData.get("name"), `${roleLabels[role]} 사용자`);
  const password = normalizeRequiredText(formData.get("password"));

  if (!identifier) {
    redirect("/login?error=identifier");
  }

  if (role !== "admin" && !password) {
    redirect("/login?error=password_required");
  }

  if (role === "admin" && adminKey !== adminLoginKey) {
    redirect("/login?role=admin&error=admin_key");
  }

  const { data: existingProfile, error: readError } = await supabase
    .from("profiles")
    .select("id, identifier, name, role")
    .eq("identifier", identifier)
    .maybeSingle();

  if (readError) {
    redirect("/login?error=read");
  }

  let profile = existingProfile;

  if (profile) {
    if (role !== "admin" && profile.role !== role) {
      // Update role in DB to match what the user selected in the demo login screen
      await supabase.from("profiles").update({ role }).eq("id", profile.id);
      profile.role = role as any;
    }
    // Temporarily disabled password hashing verification because the column is not in the database yet
    // if (role !== "admin") {
    //   const hashed = hashPassword(password);
    //   if (profile.password_hash && profile.password_hash !== hashed) {
    //     redirect("/login?error=invalid_password");
    //   }
    //   if (!profile.password_hash) {
    //     await supabase.from("profiles").update({ password_hash: hashed }).eq("id", profile.id);
    //   }
    // }
  } else {
    profile = await createProfile({ identifier, name, role, password });
  }

  if (!profile) {
    redirect("/login?error=create");
    throw new Error("create profile failed");
  }

  cookieStore.set("pacemate_profile_id", profile!.id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
  cookieStore.set("pacemate_role", profile!.role, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });

  await applyPendingOnboarding(profile!.id, role, cookieStore.get("pacemate_pending_student_types")?.value);
  cookieStore.delete("pacemate_pending_role");
  cookieStore.delete("pacemate_pending_student_types");

  // Redirection Logic
  if (profile!.role === "student") {
    // Check if onboarded (target_career is not null when onboarded)
    const { data: studentData } = await supabase
      .from("student_profiles")
      .select("target_career")
      .eq("profile_id", profile!.id)
      .maybeSingle();

    if (!studentData?.target_career) {
      redirect("/onboarding");
    }
  } else if (profile!.role === "assistant") {
    if (!cookieStore.get("pacemate_advising_professor_id")) {
      redirect("/onboarding?step=assistant-lab");
    }
  }

  redirect(getRoleHomePath(profile!.role));
}

async function createProfile({
  identifier,
  name,
  role,
  password,
}: {
  identifier: string;
  name: string;
  role: DemoRole;
  password?: string;
}) {
  const insertData: any = { identifier, name, role };
  // if (role !== "admin" && password) {
  //   insertData.password_hash = hashPassword(password);
  // }

  const { data, error } = await supabase
    .from("profiles")
    .insert(insertData)
    .select("id, identifier, name, role")
    .single();

  if (error) {
    redirect("/login?error=create");
  }

  return data;
}

export async function clearDemoSession() {
  const cookieStore = await cookies();
  cookieStore.delete("pacemate_profile_id");
  cookieStore.delete("pacemate_role");
  redirect("/login");
}

async function applyPendingOnboarding(
  profileId: string,
  role: DemoRole,
  rawStudentTypes?: string,
) {
  if (role !== "student") {
    return;
  }

  const userTypes = normalizePendingStudentTypes(rawStudentTypes);

  if (!userTypes.length) {
    return;
  }

  await supabase.from("student_profiles").upsert(
    {
      profile_id: profileId,
      user_types: userTypes,
    },
    { onConflict: "profile_id" },
  );
}
