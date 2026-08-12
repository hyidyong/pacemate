import { NextResponse, type NextRequest } from "next/server";
import { processSsoCallback } from "@/services/sso-callback.service";

// Stage 7 (SSO readiness) — the SSO callback endpoint.
//
// Deliberately thin: the only request inputs consumed are the one-time auth
// `code` (verified by exchanging it with the auth platform) and nothing else.
// Tenant, role, and destination are NEVER read from this request — they
// derive server-side from the verified identity (sso-callback.service.ts).
// All redirects are app-relative paths resolved against our own origin, so
// no open redirect exists.

export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const code = request.nextUrl.searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=sso_failed`);
  }

  const result = await processSsoCallback(code);
  return NextResponse.redirect(`${origin}${result.redirectTo}`);
}
