import { cache } from "react";
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

// Request-scoped memo: the page and AppShell both resolve the profile during one
// render; cache() collapses them into a single profiles query per request.
export const getDemoProfile = cache(async (): Promise<DemoProfile | null> => {
  try {
    const session = await readDemoSession();
    const supabase = await createSupabaseServerClient();

    if (session) {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, identifier, name, role, school_id, department_id, auth_user_id")
        .eq("id", session.profileId)
        .maybeSingle();

      if (error || !data || session.role !== data.role) return null;
      return toDemoProfile(data as AuthMappedProfile);
    }

    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) return null;

    const { data, error } = await supabase
      .from("profiles")
      .select("id, identifier, name, role, school_id, department_id, auth_user_id")
      .eq("auth_user_id", authData.user.id)
      .maybeSingle();

    if (error || !data || data.auth_user_id !== authData.user.id) return null;

    return toDemoProfile(data as AuthMappedProfile);
  } catch (error) {
    console.error("Failed to resolve the current session profile", error);
    return null;
  }
});

export async function getSignedDemoProfile(): Promise<DemoProfile | null> {
  try {
    const session = await readDemoSession();
    if (!session) return null;

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("profiles")
      .select("id, identifier, name, role, school_id, department_id, auth_user_id")
      .eq("id", session.profileId)
      .maybeSingle();

    if (error || !data || session.role !== data.role) return null;
    return toDemoProfile(data as AuthMappedProfile);
  } catch (error) {
    console.error("Failed to resolve the signed demo profile", error);
    return null;
  }
}
