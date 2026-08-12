import { createBrowserClient } from "@supabase/ssr";
import { type SupabaseClient } from "@supabase/supabase-js";
import { createTimeoutFetch } from "@/lib/supabase/fetch-timeout";

// Stage 9 (Codex, Realtime item). This was a bare `createClient`, which never
// reads the Supabase auth cookie — so the Realtime socket connected as `anon`.
// That was invisible until Stage 8 removed anon's SELECT policy on
// user_notifications, at which point live notification delivery stopped
// silently (page loads and the bell are server-rendered, so nothing looked
// broken). `createBrowserClient` from @supabase/ssr reads the same cookies the
// server session uses, so the socket authenticates as the signed-in user and
// the tenant-scoped SELECT policy applies to it — the RLS fix stays intact and
// the client is corrected instead.

let client: SupabaseClient | null = null;

function getSupabaseClient(): SupabaseClient {
  if (!client) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

    if (!supabaseUrl || !supabasePublishableKey) {
      // Validated lazily (not at module load) so importing this module never
      // crashes a whole route; callers see the error on first actual use.
      throw new Error("Missing Supabase environment variables");
    }

    client = createBrowserClient(supabaseUrl, supabasePublishableKey, {
      global: { fetch: createTimeoutFetch() },
    });
  }

  return client;
}

export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const instance = getSupabaseClient();
    const value = Reflect.get(instance, prop, instance);
    return typeof value === "function" ? value.bind(instance) : value;
  },
});
