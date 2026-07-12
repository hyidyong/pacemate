import { supabase } from "@/lib/supabase/client";
import { readDemoSession } from "@/lib/auth/demo-session";

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
  const session = await readDemoSession();

  if (!session) {
    return null;
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("id, identifier, name, role, school_id, department_id")
    .eq("id", session.profileId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  if (session && session.role !== data.role) {
    return null;
  }

  return data as DemoProfile;
}
