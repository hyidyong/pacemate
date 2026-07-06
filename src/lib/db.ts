import { supabase } from "./supabase/client";

export async function getRoleByUserId(profileId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", profileId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return data.role;
}
