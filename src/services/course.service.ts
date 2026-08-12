// Stage 9: the `demo anon ...` policies this module relied on are gone
// (20260814010000). Reads and writes now go through the caller's own
// session, so RLS enforces ownership and tenancy instead of the anon role.
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type CourseSummary = {
  id: string;
  code: string;
  name: string;
  credit: number;
  category: string | null;
  description: string | null;
  prerequisite_text: string | null;
};

export async function getCourseSummaries(): Promise<CourseSummary[]> {
  const { data, error } = await (await createSupabaseServerClient())
    .from("courses")
    .select("id, code, name, credit, category, description, prerequisite_text")
    .order("name", { ascending: true });

  if (error) {
    throw new Error(`Failed to load courses: ${error.message}`);
  }

  return data ?? [];
}

export async function getCourseById(courseId: string): Promise<CourseSummary | null> {
  const { data, error } = await (await createSupabaseServerClient())
    .from("courses")
    .select("id, code, name, credit, category, description, prerequisite_text")
    .eq("id", courseId)
    .single();

  if (error) {
    console.error(`Failed to load course: ${error.message}`);
    return null;
  }

  return data;
}
