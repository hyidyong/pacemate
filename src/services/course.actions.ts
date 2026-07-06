"use server";

import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase/client";
import { getDemoProfile } from "@/services/session.service";

export async function addCourseToSchedule(courseId: string) {
  const profile = await getDemoProfile();
  if (!profile || profile.role !== "student") {
    return { error: "학생 권한이 필요합니다." };
  }

  const { error } = await supabase.from("student_courses").upsert({
    student_id: profile.id,
    course_id: courseId,
    status: "interested", // Using 'interested' to mark as taking/registered
    semester_label: "2026-2",
  }, { onConflict: "student_id,course_id,status" });

  if (error) {
    console.error("Failed to add course:", error);
    return { error: "강의 등록에 실패했습니다." };
  }

  revalidatePath("/courses");
  revalidatePath("/dashboard");
  revalidatePath("/roadmap");

  return { success: true };
}
