import { supabase } from "@/lib/supabase/client";

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
  const { data, error } = await supabase
    .from("courses")
    .select("id, code, name, credit, category, description, prerequisite_text")
    .order("name", { ascending: true });

  if (error) {
    throw new Error(`Failed to load courses: ${error.message}`);
  }

  return data ?? [];
}

export async function getCourseById(courseId: string): Promise<CourseSummary | null> {
  const { data, error } = await supabase
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
