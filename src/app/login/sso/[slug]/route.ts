import { NextResponse, type NextRequest } from "next/server";
import { findSsoProviderBySlug } from "@/lib/sso/provider-registry";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { loadSsoProviderRegistry } from "@/services/sso-callback.service";

// Stage 7 (SSO readiness) — institution-specific SSO initiation
// (/login/sso/[slug], SSO_DESIGN §10). The slug selects WHICH registered
// provider to try — it authorizes nothing; every authorization decision
// happens in the callback from the VERIFIED identity. With no provider
// registered (the current state — real university configuration is BLOCKED)
// this answers with a controlled sso_not_configured denial.

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> },
) {
  const origin = request.nextUrl.origin;
  const { slug } = await context.params;

  const provider = findSsoProviderBySlug(loadSsoProviderRegistry(), slug);
  if (!provider || !provider.enabled) {
    return NextResponse.redirect(`${origin}/login?error=sso_not_configured`);
  }

  const redirectTo = `${origin}/auth/callback`;

  try {
    const supabase = await createSupabaseServerClient();

    if (provider.protocol === "saml") {
      const { data, error } = await supabase.auth.signInWithSSO({
        providerId: provider.providerRef,
        options: { redirectTo },
      });
      if (error || !data?.url) {
        return NextResponse.redirect(`${origin}/login?error=sso_failed`);
      }
      return NextResponse.redirect(data.url);
    }

    const { data, error } = await supabase.auth.signInWithOAuth({
      // The registry parser guarantees the "custom:<slug>" shape for OIDC.
      provider: provider.providerRef as `custom:${string}`,
      options: { redirectTo, skipBrowserRedirect: true },
    });
    if (error || !data?.url) {
      return NextResponse.redirect(`${origin}/login?error=sso_failed`);
    }
    return NextResponse.redirect(data.url);
  } catch {
    return NextResponse.redirect(`${origin}/login?error=sso_failed`);
  }
}
