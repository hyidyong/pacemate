import type { NextRequest } from "next/server";
import { updateSupabaseSession } from "@/lib/supabase/proxy";
import { REQUEST_ID_HEADER, resolveRequestId } from "@/lib/observability/request-id";

export async function middleware(request: NextRequest) {
  // Mint the correlation id before anything else runs, and set it on the
  // REQUEST so server components and actions can read it via headers(). The
  // proxy rebuilds the response from `request`, so the header survives.
  const requestId = resolveRequestId(request.headers);
  request.headers.set(REQUEST_ID_HEADER, requestId);

  const response = await updateSupabaseSession(request);
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
}

export const config = {
  runtime: "nodejs",
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map)$).*)",
  ],
};
