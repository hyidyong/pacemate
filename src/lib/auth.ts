import { supabase } from "./supabase/client";

// Auth Provider Interface
export interface AuthProvider {
  login(identifier: string, password?: string): Promise<{ id: string; role: string } | null>;
}

// Supabase Auth Provider Implementation
class SupabaseAuthProvider implements AuthProvider {
  async login(identifier: string, password?: string) {
    // NOTE: 현재 데모 로그인 시스템이므로 identifier로 profile 조회
    const { data: profile, error } = await supabase
      .from("profiles")
      .select("id, role")
      .eq("identifier", identifier)
      .maybeSingle();

    if (error || !profile) return null;
    
    return {
      id: profile.id,
      role: profile.role
    };
  }
}

// Export a singleton instance of the AuthProvider
export const authProvider: AuthProvider = new SupabaseAuthProvider();
