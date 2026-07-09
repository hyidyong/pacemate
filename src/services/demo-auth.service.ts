"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { authProvider } from "@/lib/auth";
import { getRoleByUserId } from "@/lib/db";
import { getRoleHomePath } from "@/services/session.service";
import { supabase } from "@/lib/supabase/client";
import demoUsers from "@/config/demo-users.json";

function normalizeRequiredText(value: FormDataEntryValue | null, fallback = "") {
  const text = typeof value === "string" ? value.trim() : "";
  return text || fallback;
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

  // 1. Auth Provider를 통한 인증
  const authResult = await authProvider.login(identifier, password);
  let profileId = authResult?.id;

  // 데모 편의: DB에 유저가 없으면 demoUsers.json에서 찾아 생성해줌
  if (!profileId) {
    const demoUser = demoUsers.find((u) => u.identifier === identifier);
    if (demoUser && demoUser.password === password) {
      const { data: existingProfile } = await supabase
        .from("profiles")
        .select("id")
        .eq("identifier", demoUser.identifier)
        .maybeSingle();

      if (existingProfile) {
        redirect("/login?error=duplicate_identifier");
      }

      const { data: newProfile, error: insertError } = await supabase
        .from("profiles")
        .insert({
          identifier: demoUser.identifier,
          name: demoUser.name,
          role: demoUser.role,
        })
        .select("id")
        .single();

      if (insertError) {
        if (insertError.code === "23505" || /duplicate|already exists/i.test(insertError.message)) {
          redirect("/login?error=duplicate_identifier");
        }
        redirect("/login?error=create");
      }

      if (newProfile) {
        profileId = newProfile.id;
      }
    } else {
      // 데모 유저도 아니면 로그인 실패
      redirect("/login?error=invalid_password");
    }
  }

  if (!profileId) {
    redirect("/login?error=invalid_password");
    throw new Error("Login failed");
  }

  // 2. RBAC 적용 (로그인 성공 후 DB에서 Role 조회)
  const role = await getRoleByUserId(profileId);
  if (!role) {
    redirect("/login?error=read");
    throw new Error("Role not found");
  }

  // 세션 설정
  cookieStore.set("pacemate_profile_id", profileId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
  cookieStore.set("pacemate_role", role, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });

  // 온보딩 중 저장된 정보가 있다면 적용
  await applyPendingOnboarding(profileId, role as any, cookieStore.get("pacemate_pending_student_types")?.value);
  cookieStore.delete("pacemate_pending_role");
  cookieStore.delete("pacemate_pending_student_types");

  // Redirection Logic (기존 로직 유지)
  if (role === "student") {
    const { data: studentData } = await supabase
      .from("student_profiles")
      .select("is_onboarded")
      .eq("profile_id", profileId)
      .maybeSingle();

    if (!studentData?.is_onboarded) {
      redirect("/onboarding");
    }
  } else if (role === "assistant") {
    if (!cookieStore.get("pacemate_advising_professor_id")) {
      redirect("/onboarding?step=assistant-lab");
    }
  }

  redirect(getRoleHomePath(role as any));
}

export async function clearDemoSession() {
  const cookieStore = await cookies();
  cookieStore.delete("pacemate_profile_id");
  cookieStore.delete("pacemate_role");
  redirect("/login");
}

type StudentType = "freshman" | "transfer" | "cross_major" | "double_major" | "current_student";
const allowedStudentTypes = new Set<StudentType>(["freshman", "transfer", "cross_major", "double_major", "current_student"]);

function normalizePendingStudentTypes(value?: string) {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item): item is StudentType => allowedStudentTypes.has(item as StudentType));
}

async function applyPendingOnboarding(profileId: string, role: string, rawStudentTypes?: string) {
  if (role !== "student") return;

  const userTypes = normalizePendingStudentTypes(rawStudentTypes);
  if (!userTypes.length) return;

  await supabase.from("student_profiles").upsert(
    {
      profile_id: profileId,
      user_types: userTypes,
    },
    { onConflict: "profile_id" }
  );
}
