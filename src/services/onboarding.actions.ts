"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import type { StudentType } from "@/services/onboarding.service";
import type { DemoProfile } from "@/services/session.service";

const allowedStudentTypes = new Set<StudentType>([
  "freshman",
  "transfer",
  "cross_major",
  "double_major",
  "current_student",
]);

async function getProfileId() {
  const cookieStore = await cookies();
  return cookieStore.get("pacemate_profile_id")?.value ?? null;
}

function text(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

function optionalNumber(value: FormDataEntryValue | null) {
  const current = Number(text(value));
  return Number.isFinite(current) && current > 0 ? current : null;
}

function csv(value: FormDataEntryValue | null) {
  return text(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function selectedStudentTypes(formData: FormData) {
  return formData
    .getAll("userTypes")
    .filter((value): value is StudentType => {
      return typeof value === "string" && allowedStudentTypes.has(value as StudentType);
    });
}

function normalizeRole(value: FormDataEntryValue | null): DemoProfile["role"] {
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

export async function beginOnboarding(formData: FormData) {
  const role = normalizeRole(formData.get("role"));
  const userTypes = selectedStudentTypes(formData);
  const cookieStore = await cookies();

  cookieStore.set("pacemate_pending_role", role, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });

  if (userTypes.length) {
    cookieStore.set("pacemate_pending_student_types", userTypes.join(","), {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    });
  } else {
    cookieStore.delete("pacemate_pending_student_types");
  }

  if (role === "student" && !userTypes.length) {
    redirect("/onboarding?step=student-types");
  }

  redirect(`/login?role=${role}`);
}

export async function saveStudentOnboarding(formData: FormData) {
  const profileId = await getProfileId();

  if (!profileId) {
    redirect("/login");
  }

  const userTypes = selectedStudentTypes(formData);
  const grade = optionalNumber(formData.get("grade"));
  const semester = optionalNumber(formData.get("semester"));

  if (!userTypes.length || !grade || !semester) {
    redirect("/onboarding?error=required");
  }

  await ensureDefaultSchoolAndDepartment(profileId);

  const { error } = await supabase.from("student_profiles").upsert(
    {
      profile_id: profileId,
      user_types: userTypes,
      grade,
      semester,
      target_career: text(formData.get("targetCareer")) || null,
      interests: csv(formData.get("interests")),
      weak_basics: csv(formData.get("weakBasics")),
      completed_courses_text: text(formData.get("completedCourses")) || null,
      is_onboarded: true,
    },
    { onConflict: "profile_id" },
  );

  const returnTo = text(formData.get("returnTo"));

  if (error) {
    redirect(`/onboarding?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/onboarding");
  revalidatePath("/dashboard");
  revalidatePath("/roadmap");
  revalidatePath("/mypage");
  redirect(returnTo || "/roadmap");
}

async function ensureDefaultSchoolAndDepartment(profileId: string) {
  const { data: profile } = await supabase
    .from("profiles")
    .select("school_id, department_id")
    .eq("id", profileId)
    .maybeSingle();

  if (profile?.school_id && profile?.department_id) {
    return;
  }

  const { data: school } = await supabase
    .from("schools")
    .select("id")
    .eq("name", "계명대학교")
    .maybeSingle();

  if (!school?.id) {
    return;
  }

  const { data: department } = await supabase
    .from("departments")
    .select("id")
    .eq("school_id", school.id)
    .eq("name", "법학과")
    .maybeSingle();

  await supabase
    .from("profiles")
    .update({
      school_id: profile?.school_id ?? school.id,
      department_id: profile?.department_id ?? department?.id ?? null,
    })
    .eq("id", profileId);
}

export async function saveAssistantOnboarding(formData: FormData) {
  const profileId = await getProfileId();
  if (!profileId) {
    redirect("/login");
  }

  const professorId = text(formData.get("professorId"));
  if (!professorId) {
    redirect("/onboarding?error=required");
  }

  const cookieStore = await cookies();
  cookieStore.set("pacemate_advising_professor_id", professorId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });

  revalidatePath("/onboarding");
  revalidatePath("/admin");
  redirect("/admin");
}
