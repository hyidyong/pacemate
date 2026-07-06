import { supabase } from "@/lib/supabase/client";
import type { DemoProfile } from "@/services/session.service";

export type StudentType =
  | "freshman"
  | "transfer"
  | "cross_major"
  | "double_major"
  | "current_student";

export type StudentOnboardingProfile = {
  user_types: StudentType[];
  grade: number | null;
  semester: number | null;
  target_career: string | null;
  interests: string[];
  weak_basics: string[];
  completed_courses_text: string | null;
};

export async function getStudentOnboardingProfile(
  profile: DemoProfile | null,
): Promise<StudentOnboardingProfile | null> {
  if (!profile) {
    return null;
  }

  const { data, error } = await supabase
    .from("student_profiles")
    .select(
      "user_types, grade, semester, target_career, interests, weak_basics, completed_courses_text",
    )
    .eq("profile_id", profile.id)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return data as StudentOnboardingProfile;
}
