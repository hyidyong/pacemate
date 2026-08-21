"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
// Stage 9: onboarding writes the caller's tenant and department onto their
// profile. `profiles` UPDATE is now restricted to the `name` column for
// session roles (20260814010000), so these writes run under the service
// role AFTER getProfileId() has established who the caller is.
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { readDemoSession } from "@/lib/auth/demo-session";
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
  const session = await readDemoSession();
  return session?.role === "student" ? session.profileId : null;
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

  const { error } = await createSupabaseAdminClient().from("student_profiles").upsert(
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

export async function completeStudentOnboarding(formData: FormData) {
  const profileId = await getProfileId();

  if (!profileId) {
    redirect("/login");
  }

  const department = text(formData.get("department"));
  const grade = optionalNumber(formData.get("grade"));
  const semester = optionalNumber(formData.get("semester"));
  const completedCourseIds = csv(formData.get("completedCourses"));

  if ((department !== "law" && department !== "electronic-engineering") || !grade || !semester) {
    redirect("/onboarding?error=required");
  }

  await ensureDefaultSchoolAndDepartment(profileId, department);

  const { data: currentProfile } = await createSupabaseAdminClient()
    .from("student_profiles")
    .select("user_types")
    .eq("profile_id", profileId)
    .maybeSingle();

  const existingTypes = Array.isArray(currentProfile?.user_types)
    ? currentProfile.user_types.filter((value): value is StudentType => {
        return typeof value === "string" && allowedStudentTypes.has(value as StudentType);
      })
    : [];

  const { error } = await createSupabaseAdminClient().from("student_profiles").upsert(
    {
      profile_id: profileId,
      user_types: existingTypes.length ? existingTypes : ["current_student"],
      grade,
      semester,
      completed_courses_text: completedCourseIds.join(",") || null,
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

async function ensureDefaultSchoolAndDepartment(profileId: string, departmentKey = "law") {
  const { data: profile } = await createSupabaseAdminClient()
    .from("profiles")
    .select("school_id, department_id")
    .eq("id", profileId)
    .maybeSingle();

  const { data: school } = await createSupabaseAdminClient()
    .from("schools")
    .select("id")
    .eq("name", "계명대학교")
    .maybeSingle();

  const schoolId = profile?.school_id ?? school?.id;
  if (!schoolId) {
    return;
  }

  const departmentName = departmentKey === "electronic-engineering" ? "전자공학과" : "법학과";
  const { data: department } = await createSupabaseAdminClient()
    .from("departments")
    .select("id")
    .eq("school_id", schoolId)
    .eq("name", departmentName)
    .maybeSingle();

  await createSupabaseAdminClient()
    .from("profiles")
    .update({
      school_id: schoolId,
      department_id: department?.id ?? profile?.department_id ?? null,
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
