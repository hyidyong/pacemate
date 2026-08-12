import type { NextRequest } from "next/server";
import { updateSupabaseSession } from "@/lib/supabase/proxy";
import { REQUEST_ID_HEADER, mintRequestId } from "@/lib/observability/request-id";

export async function middleware(request: NextRequest) {
  // Mint the correlation id before anything else runs, and set it on the
  // REQUEST so server components and actions can read it via headers(). The
  // proxy rebuilds the response from `request`, so the header survives.
  //
  // mintRequestId never adopts the inbound REQUEST_ID_HEADER: that header is
  // ours, but on an inbound request the client controls it, and a caller must
  // not be able to choose their own correlation id (review finding 6). Setting
  // it here unconditionally also overwrites anything a client sent.
  const requestId = mintRequestId(request.headers);
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
