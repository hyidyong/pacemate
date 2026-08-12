/**
 * Next.js instrumentation (Stage 8 P2).
 *
 * Before this, an unhandled server-side error reached the operator only as
 * Next's default digest line, and `src/app/error.tsx` — the only error boundary
 * — is a client component, so its console.error logs in the USER's browser, not
 * on the server. `onRequestError` is the Next-native hook that closes that gap
 * with no dependency and no vendor.
 */

import { logEvent } from "@/lib/observability/log";
import { REQUEST_ID_HEADER } from "@/lib/observability/request-id";

export function register() {
  // No startup work needed; the hook below is the payload. Next requires this
  // export to exist for the instrumentation module to load.
}

type RequestErrorPayload = {
  path?: string;
  headers?: Record<string, string | string[] | undefined>;
};

type ErrorContext = {
  routerKind?: string;
  routePath?: string;
  routeType?: string;
};

export function onRequestError(
  error: unknown,
  request: RequestErrorPayload,
  context: ErrorContext,
) {
  const header = request.headers?.[REQUEST_ID_HEADER];
  const requestId = Array.isArray(header) ? header[0] : header;

  logEvent({
    event: "server.unhandled_error",
    outcome: "fault",
    requestId,
    route: context.routePath ?? request.path,
    // The error NAME only. Messages can carry query fragments, row values, or
    // upstream bodies, none of which belong in logs (see log.ts).
    detail: error instanceof Error ? error.name : "UnknownError",
  });
}
