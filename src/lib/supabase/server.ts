import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { createTimeoutFetch } from "@/lib/supabase/fetch-timeout";

function getRequiredEnv(name: "NEXT_PUBLIC_SUPABASE_URL" | "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required for Supabase Auth SSR`);
  }

  return value;
}

/**
 * Creates a request-scoped Supabase client that reads and refreshes Auth
 * cookies through the current Next.js request.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(
    getRequiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
    getRequiredEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Server Components cannot always mutate cookies. Middleware and
            // Server Actions perform the refresh/write when available.
          }
        },
      },
      global: { fetch: createTimeoutFetch() },
    },
  );
}


