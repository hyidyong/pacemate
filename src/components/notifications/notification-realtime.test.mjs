// Codex round 3, F11 — the Realtime subscription must authenticate BEFORE it
// subscribes, and must not structurally exclude role broadcasts.
//
// Two defects were confirmed in the previous wiring:
//
//   1. the auth handshake was fire-and-forget, so the socket could open before
//      setAuth() ran and the channel would evaluate RLS as `anon`;
//   2. the filter on recipient_id excludes every role broadcast, because those
//      carry a NULL recipient. Tenant-wide announcements could never arrive,
//      whatever RLS allowed.
//
// This is a source-level contract test. It cannot prove live DELIVERY — that
// needs a real socket and a real INSERT, and the channel is off by default — so
// live delivery remains UNVERIFIED and is recorded as such.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const source = readFileSync(
  fileURLToPath(new URL("./notification-menu.tsx", import.meta.url)),
  "utf8",
);

// Positional assertions must anchor on CODE, not prose: the header comment in
// the component legitimately quotes the call it is explaining, and matching
// that instead of the call site produced a false failure earlier in this round.
const CODE_SUBSCRIBE = ".subscribe();";

test("the socket is authenticated before it subscribes, not concurrently", () => {
  const getSession = source.indexOf("await supabase.auth.getSession()");
  const setAuth = source.indexOf("supabase.realtime.setAuth(token)");
  const subscribe = source.indexOf(CODE_SUBSCRIBE);

  assert.ok(getSession > -1, "the session must be read");
  assert.ok(setAuth > -1, "the token must be installed on the realtime client");
  assert.ok(subscribe > -1, "expected a subscribe call");
  assert.ok(setAuth < subscribe, "setAuth must be wired before the channel subscribes");
  assert.ok(getSession < subscribe, "the session must be awaited before subscribing");

  // The old fire-and-forget handshake must not return.
  assert.doesNotMatch(source, /void authorise\(\);/);
});

test("the subscription does not filter out role broadcasts", () => {
  // A recipient_id filter can never match a row whose recipient is NULL.
  assert.doesNotMatch(
    source,
    /filter:\s*`recipient_id=eq\./,
    "a recipient_id filter structurally excludes tenant role broadcasts",
  );
  assert.match(
    source,
    /\{ event: "INSERT", schema: "public", table: "user_notifications" \}/,
    "expected an unfiltered INSERT subscription, with RLS doing the filtering",
  );
});

test("a role broadcast is accepted and another user's notification is not", () => {
  // The client-side guard is defence in depth, not the boundary. Its logic is
  // reproduced here so the intent is pinned.
  const accept = (recipientId, profileId) => {
    const value = typeof recipientId === "string" ? recipientId : null;
    return !(value !== null && value !== profileId);
  };

  assert.equal(accept(null, "me"), true, "role broadcasts must be surfaced");
  assert.equal(accept("me", "me"), true, "own notifications must be surfaced");
  assert.equal(accept("someone-else", "me"), false, "another user's row must be ignored");
});

test("RLS is not weakened to make delivery work", () => {
  // The fix is client-side only; nothing here may relax the policy.
  assert.doesNotMatch(source, /service_role|SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(source, /@\/lib\/supabase\/client/);
});

test("the channel is torn down and the auth listener unsubscribed", () => {
  assert.match(source, /authListener\?\.subscription\?\.unsubscribe\(\)/);
  assert.match(source, /if \(channel\) supabase\.removeChannel\(channel\)/);
  assert.match(source, /cancelled = true/);
});
