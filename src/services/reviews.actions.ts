"use server";

import { revalidatePath } from "next/cache";
// Stage 9: the `demo anon ...` policies this module relied on are gone
// (20260814010000). Reads and writes now go through the caller's own
// session, so RLS enforces ownership and tenancy instead of the anon role.
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getDemoProfile } from "@/services/session.service";

function text(value: FormDataEntryValue | null, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function rating(value: FormDataEntryValue | null) {
  const parsed = Number.parseInt(text(value), 10);
  return Number.isFinite(parsed) ? Math.min(5, Math.max(1, parsed)) : null;
}

export async function createCourseReview(formData: FormData) {
  const profile = await getDemoProfile();
  const courseId = text(formData.get("courseId"));
  const content = text(formData.get("content"));

  if (!profile) {
    return { ok: false, message: "로그인 후 후기를 작성할 수 있습니다." };
  }

  // Codex round 4, finding 2. A course review is student experience — /reviews
  // is gated by redirectNonStudent. That gate protected the PAGE, and a server
  // action runs before any page renders, so it protected nothing here: a
  // professor, assistant or admin could post a student-voice review in their
  // own name. Confirmed live against the database: all three roles got 201.
  //
  // The database now refuses this too (20260814160000). Both checks exist on
  // purpose: neither the action nor the policy should be the only thing
  // standing between staff opinion and the student review feed.
  if (profile.role !== "student") {
    return { ok: false, message: "수강 후기는 학생만 작성할 수 있습니다." };
  }

  if (!courseId || content.length < 8) {
    return { ok: false, message: "과목과 후기를 조금 더 구체적으로 입력해 주세요." };
  }

  const { error } = await (await createSupabaseServerClient()).from("course_reviews").insert({
    course_id: courseId,
    author_id: profile.id,
    difficulty: rating(formData.get("difficulty")),
    workload: rating(formData.get("workload")),
    grading_style: text(formData.get("gradingStyle"), "미입력"),
    team_project: text(formData.get("teamProject")) === "true",
    content,
  });

  if (error) {
    return { ok: false, message: "후기를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }

  revalidatePath("/reviews");
  return { ok: true, message: "수강 후기를 등록했습니다." };
}
