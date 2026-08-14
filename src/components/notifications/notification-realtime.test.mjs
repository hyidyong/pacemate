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

test("the client guard is an EXACT recipient match (Codex round 4, finding 1)", () => {
  // The guard is defence in depth, not the boundary — RLS already decided what
  // the socket may see. Since finding 1 fanned broadcasts out into one row per
  // recipient, `recipient_id` is NOT NULL and every deliverable row is
  // addressed to exactly one profile, so the guard is an exact match. Accepting
  // a NULL recipient would mean trusting a row the schema says cannot exist.
  //
  // The predicate is extracted from the COMPONENT rather than reimplemented, so
  // this cannot drift away from the code the way the previous version did.
  const guard = /if \(recipientId !== profileId\) return;/;
  assert.match(source, guard, "the guard must require an exact recipient match");
  assert.doesNotMatch(
    source,
    /recipientId !== null && recipientId !== profileId/,
    "the old 'mine or nobody's' guard accepted a NULL recipient",
  );

  // And the behaviour that predicate encodes.
  const accept = (recipientId, profileId) =>
    (typeof recipientId === "string" ? recipientId : null) === profileId;
  assert.equal(accept("me", "me"), true, "own notifications must be surfaced");
  assert.equal(accept("someone-else", "me"), false, "another user's row must be ignored");
  assert.equal(accept(null, "me"), false, "a NULL recipient can no longer exist and is not trusted");
});

test("broadcasts still reach their recipient — via fan-out, not a NULL recipient", () => {
  // Finding 1 must not be 'fixed' by dropping role broadcasts on the floor.
  // Delivery is preserved by the creation chokepoint writing one row per
  // recipient; each of those rows is an ordinary recipient-addressed row that
  // this subscription already carries.
  const service = readFileSync(
    fileURLToPath(new URL("../../services/notifications.create.service.ts", import.meta.url)),
    "utf8",
  );
  assert.match(service, /expandRoleBroadcasts/, "the fan-out must exist");
  assert.match(
    source,
    /\{ event: "INSERT", schema: "public", table: "user_notifications" \}/,
    "the subscription must stay unfiltered, with RLS doing the filtering",
  );
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
