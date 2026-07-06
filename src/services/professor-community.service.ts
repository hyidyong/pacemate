import { supabase } from "@/lib/supabase/client";
import type { DemoProfile } from "@/services/session.service";

export type ProfessorLoungePost = {
  id: string;
  title: string;
  content: string;
  category: string;
  display_mode: string;
  anonymous_alias: string | null;
  created_at: string;
  author: { id: string; name: string; role: string } | null;
};

export async function getProfessorLoungePosts(
  profile: DemoProfile | null,
): Promise<ProfessorLoungePost[]> {
  if (profile?.role !== "professor") {
    return [];
  }

  const { data, error } = await supabase
    .from("posts")
    .select("id, title, content, category, display_mode, anonymous_alias, created_at, author:profiles(id, name, role)")
    .eq("board_key", "professor")
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(40);

  if (error) {
    throw new Error(`Failed to load professor lounge posts: ${error.message}`);
  }

  return (data ?? []) as unknown as ProfessorLoungePost[];
}
