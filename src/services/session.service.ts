import { readDemoSession } from "@/lib/auth/demo-session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type DemoProfile = {
  id: string;
  identifier: string;
  name: string;
  role: "student" | "professor" | "assistant" | "admin";
  school_id: string | null;
  department_id: string | null;
};

type AuthMappedProfile = DemoProfile & {
  auth_user_id: string | null;
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

function toDemoProfile(profile: AuthMappedProfile): DemoProfile {
  return {
    id: profile.id,
    identifier: profile.identifier,
    name: profile.name,
    role: profile.role,
    school_id: profile.school_id,
    department_id: profile.department_id,
  };
}

export async function getDemoProfile(): Promise<DemoProfile | null> {
  const supabase = await createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();

  if (authData.user) {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, identifier, name, role, school_id, department_id, auth_user_id")
      .eq("auth_user_id", authData.user.id)
      .maybeSingle();

    if (error || !data || data.auth_user_id !== authData.user.id) {
      return null;
    }

    return toDemoProfile(data as AuthMappedProfile);
  }

  // Compatibility path for pages that still have only the signed demo cookie.
  const session = await readDemoSession();
  if (!session) {
    return null;
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("id, identifier, name, role, school_id, department_id, auth_user_id")
    .eq("id", session.profileId)
    .maybeSingle();

  if (error || !data || session.role !== data.role) {
    return null;
  }

  return toDemoProfile(data as AuthMappedProfile);
}
