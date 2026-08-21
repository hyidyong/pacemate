import { createClient } from "@supabase/supabase-js";

const INSERT_FILTER = {
  event: "INSERT",
  schema: "public",
  table: "user_notifications",
};

export function createRealtimeInbox({
  url,
  anonKey,
  accessToken,
  label,
  timeoutMs = 15000,
  createClientImpl = createClient,
}) {
  const rows = [];
  const client = createClientImpl(url, anonKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });

  // Realtime must receive the signed-in JWT before the channel opens. The
  // database SELECT policy remains the authorization boundary.
  client.realtime.setAuth(accessToken);
  const channel = client
    .channel(`stage10-notifications:${label}`)
    .on("postgres_changes", INSERT_FILTER, (payload) => {
      if (payload?.new && typeof payload.new === "object") rows.push(payload.new);
    });

  return {
    rows,
    async start() {
      await new Promise((resolve, reject) => {
        let settled = false;
        const finish = (callback, value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          callback(value);
        };
        const timeout = setTimeout(
          () => finish(reject, new Error(`${label} Realtime subscription timed out`)),
          timeoutMs,
        );

        channel.subscribe((status, error) => {
          if (status === "SUBSCRIBED") {
            finish(resolve);
            return;
          }
          if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) {
            finish(
              reject,
              new Error(`${label} Realtime subscription ${status}: ${error?.message ?? "no detail"}`),
            );
          }
        });
      });
    },
    async close() {
      await client.removeChannel(channel);
      client.realtime.disconnect();
    },
  };
}

export async function waitForRealtimeRow(
  inbox,
  rowId,
  { timeoutMs = 15000, pollMs = 25 } = {},
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (inbox.rows.some((row) => row?.id === rowId)) return true;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  return inbox.rows.some((row) => row?.id === rowId);
}

export function classifyNotificationDelivery({ directId, broadcastIds, inboxes }) {
  const has = (inbox, rowId) => inbox.rows.some((row) => row?.id === rowId);
  const broadcastIdList = [broadcastIds.a, broadcastIds.b];

  return [
    {
      id: "realtime:direct-recipient",
      property: "the intended authenticated client receives its direct notification",
      pass: has(inboxes.a, directId),
      detail: `recipient A observed ${has(inboxes.a, directId) ? 1 : 0} matching row(s)`,
    },
    {
      id: "realtime:direct-peer-isolation",
      property: "a same-tenant peer must not receive another user's direct notification",
      pass: !has(inboxes.b, directId),
      detail: `peer B observed ${has(inboxes.b, directId) ? 1 : 0} matching row(s)`,
    },
    {
      id: "realtime:direct-tenant-isolation",
      property: "another tenant must not receive the direct notification",
      pass: !has(inboxes.foreign, directId),
      detail: `foreign tenant observed ${has(inboxes.foreign, directId) ? 1 : 0} matching row(s)`,
    },
    {
      id: "realtime:broadcast-recipient-a",
      property: "eligible recipient A receives their role-broadcast fan-out row",
      pass: has(inboxes.a, broadcastIds.a),
      detail: `recipient A observed ${has(inboxes.a, broadcastIds.a) ? 1 : 0} matching row(s)`,
    },
    {
      id: "realtime:broadcast-recipient-b",
      property: "eligible recipient B receives their role-broadcast fan-out row",
      pass: has(inboxes.b, broadcastIds.b),
      detail: `recipient B observed ${has(inboxes.b, broadcastIds.b) ? 1 : 0} matching row(s)`,
    },
    {
      id: "realtime:broadcast-tenant-isolation",
      property: "another tenant must not receive either tenant-scoped broadcast row",
      pass: !broadcastIdList.some((id) => has(inboxes.foreign, id)),
      detail: `foreign tenant observed ${broadcastIdList.filter((id) => has(inboxes.foreign, id)).length} matching row(s)`,
    },
  ];
}
