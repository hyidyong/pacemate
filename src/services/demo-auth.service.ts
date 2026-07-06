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
      const { data: newProfile, error: insertError } = await supabase
        .from("profiles")
        .insert({
          identifier: demoUser.identifier,
          name: demoUser.name,
          role: demoUser.role,
        })
        .select("id")
        .single();
        
      if (!insertError && newProfile) {
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

  // Redirection Logic (기존 로직 유지)
  if (role === "student") {
    const { data: studentData } = await supabase
      .from("student_profiles")
      .select("target_career")
      .eq("profile_id", profileId)
      .maybeSingle();

    if (!studentData?.target_career) {
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
