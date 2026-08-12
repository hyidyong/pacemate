import "server-only";

import { cache } from "react";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type AuthenticatedProfileRow = {
  id: string;
  auth_user_id: string | null;
  role: string;
};

/**
 * Raw outcome of the Supabase-Auth identity chain (auth.getUser -> profiles by
 * auth_user_id). Consumers map these states onto their own error vocabularies,
 * which differ per service and are frozen by existing tests — this type
 * deliberately does NOT pick failure codes for them.
 */
export type AuthenticatedProfileResolution =
  | { status: "client_error" }
  | { status: "unauthenticated" }
  | { status: "profile_error"; error: { code?: string; status?: number } }
  | { status: "profile_missing" }
  | { status: "profile_mismatch" }
  | { status: "ok"; profile: AuthenticatedProfileRow };

// Request-scoped memo: the dashboard card services each re-derived identity
// from scratch (3x auth.getUser network round trips + 3x profiles reads per
// render). cache() collapses them into one chain per request; nothing survives
// the response, so freshness semantics are unchanged.
export const resolveAuthenticatedProfile = cache(
  async (): Promise<AuthenticatedProfileResolution> => {
    let supabase;
    try {
      supabase = await createSupabaseServerClient();
    } catch {
      return { status: "client_error" };
    }

    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData.user) {
      return { status: "unauthenticated" };
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id, auth_user_id, role")
      .eq("auth_user_id", authData.user.id)
      .maybeSingle();

    if (profileError) {
      return { status: "profile_error", error: profileError };
    }

    const row = profile as AuthenticatedProfileRow | null;
    if (!row) {
      return { status: "profile_missing" };
    }
    if (row.auth_user_id !== authData.user.id) {
      return { status: "profile_mismatch" };
    }

    return { status: "ok", profile: row };
  },
);
