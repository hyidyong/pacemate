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

/**
 * Stage 9 — request-time tenant suspension.
 *
 * Stage 7 modelled `schools.status` and built the fail-closed seam in
 * resolveTenantContext, but nothing on the session path ever read it, so
 * suspending a university left every existing session — and every new password
 * login — fully authorized. The app session is an 8h HMAC cookie with no
 * server-side store, so without this check a suspension could not take effect
 * for up to eight hours even in principle.
 *
 * Absent status is treated as active (schools.status is NOT NULL with default
 * 'active'; a missing embed means the join was not selected, not that the
 * tenant is suspended).
 */
function isSuspendedTenant(row: unknown): boolean {
  const school = (row as { school?: { status?: string } | { status?: string }[] } | null)?.school;
  const status = Array.isArray(school) ? school[0]?.status : school?.status;
  return typeof status === "string" && status !== "active";
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
        .select("id, identifier, name, role, school_id, department_id, auth_user_id, school:schools(status)")
        .eq("id", session.profileId)
        .maybeSingle();

      if (error || !data || session.role !== data.role) return null;
      if (isSuspendedTenant(data)) return null;
      return toDemoProfile(data as AuthMappedProfile);
    }

    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) return null;

    const { data, error } = await supabase
      .from("profiles")
      .select("id, identifier, name, role, school_id, department_id, auth_user_id, school:schools(status)")
      .eq("auth_user_id", authData.user.id)
      .maybeSingle();

    if (error || !data || data.auth_user_id !== authData.user.id) return null;
    if (isSuspendedTenant(data)) return null;

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
      .select("id, identifier, name, role, school_id, department_id, auth_user_id, school:schools(status)")
      .eq("id", session.profileId)
      .maybeSingle();

    if (error || !data || session.role !== data.role) return null;
    if (isSuspendedTenant(data)) return null;
    return toDemoProfile(data as AuthMappedProfile);
  } catch (error) {
    console.error("Failed to resolve the signed demo profile", error);
    return null;
  }
}
