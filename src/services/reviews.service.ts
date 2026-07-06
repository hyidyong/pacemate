import { supabase } from "@/lib/supabase/client";
import type { CourseSummary } from "@/services/course.service";

export type CourseReview = {
  id: string;
  course_id: string | null;
  author_id: string | null;
  difficulty: number | null;
  workload: number | null;
  grading_style: string | null;
  team_project: boolean | null;
  content: string;
  created_at: string;
  course: Pick<CourseSummary, "id" | "code" | "name"> | null;
  author: { id: string; name: string; role: string } | null;
};

export async function getCourseReviews(): Promise<CourseReview[]> {
  const { data, error } = await supabase
    .from("course_reviews")
    .select(
      "id, course_id, author_id, difficulty, workload, grading_style, team_project, content, created_at, course:courses(id, code, name), author:profiles(id, name, role)",
    )
    .order("created_at", { ascending: false })
    .limit(80);

  if (error) {
    throw new Error(`Failed to load course reviews: ${error.message}`);
  }

  return (data ?? []) as unknown as CourseReview[];
}
