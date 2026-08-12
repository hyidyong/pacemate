import "server-only";

import { headers } from "next/headers";
import { readRequestId } from "@/lib/observability/request-id";

/**
 * Reads the correlation id middleware set, for attaching to structured log
 * events from server components, server actions, and route handlers
 * (review finding 6).
 *
 * Returns undefined rather than throwing when called outside a request scope,
 * or when the header is missing or unsafe — an event without a requestId is
 * still worth emitting, and is far better than one carrying attacker-chosen
 * content (see request-id.ts for the trust boundary).
 */
export async function getRequestId(): Promise<string | undefined> {
  try {
    return readRequestId(await headers());
  } catch {
    return undefined;
  }
}
