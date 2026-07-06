import { cookies } from "next/headers";
import { supabase } from "@/lib/supabase/client";

export type DemoProfile = {
  id: string;
  identifier: string;
  name: string;
  role: "student" | "professor" | "assistant" | "admin";
  school_id: string | null;
  department_id: string | null;
};

export function getRoleHomePath(role: DemoProfile["role"]) {
  if (role === "professor") {
    return "/professor";
  }

  if (role === "assistant" || role === "admin") {
    return "/admin";
  }

  return "/dashboard";
}

export async function getDemoProfile(): Promise<DemoProfile | null> {
  const cookieStore = await cookies();
  const profileId = cookieStore.get("pacemate_profile_id")?.value;

  if (!profileId) {
    return null;
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("id, identifier, name, role, school_id, department_id")
    .eq("id", profileId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return data as DemoProfile;
}
