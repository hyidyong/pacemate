// Real login sessions for virtual users.
//
// WHY NOT a hand-minted pacemate_session cookie: that cookie alone satisfies
// getDemoProfile, but it carries no GoTrue session, so every session-client
// query then runs as the `anon` Postgres role. `anon` has no SELECT grant on
// counseling_requests / professor_admin_tasks / student_custom_courses, so the
// counseling page renders its error fallback and the measurement would be of a
// broken page. Real users authenticate through GoTrue and query as
// `authenticated`. The harness therefore logs each virtual user in through the
// app's own login server action and reuses the resulting cookie jar.

import { loadActionIds, invokeServerAction } from "./server-action.mjs";

export function createCookieJar(initial = {}) {
  const jar = new Map(Object.entries(initial));
  return {
    absorb(setCookieHeaders = []) {
      for (const header of setCookieHeaders) {
        const [pair] = header.split(";");
        const eq = pair.indexOf("=");
        if (eq < 1) continue;
        const name = pair.slice(0, eq).trim();
        const value = pair.slice(eq + 1).trim();
        if (value === "" || /expires=Thu, 01 Jan 1970/i.test(header)) jar.delete(name);
        else jar.set(name, value);
      }
    },
    header() {
      return Array.from(jar.entries())
        .map(([k, v]) => `${k}=${v}`)
        .join("; ");
    },
    has(name) {
      return jar.has(name);
    },
    names() {
      return Array.from(jar.keys());
    },
  };
}

// Drives the real login server action and returns a populated cookie jar.
export async function loginVirtualUser({ baseUrl, identifier, password, actionIds }) {
  const ids = actionIds ?? loadActionIds();
  const jar = createCookieJar();

  // Login is bound as an RSC <form action={...}>, so it supports the no-JS
  // progressive-enhancement encoding: the action id travels as a $ACTION_ID_*
  // body field rather than the Next-Action header. That path returns a real 303
  // with Set-Cookie headers; the header form returns a Flight stream whose
  // redirect the harness cannot absorb cookies from.
  const form = new FormData();
  form.set("identifier", identifier);
  form.set("password", password);
  form.set(`$ACTION_ID_${ids.get("createDemoSession")}`, "");

  const res = await fetch(`${baseUrl}/login`, {
    method: "POST",
    headers: { Origin: baseUrl, "accept-language": "ko-KR" },
    body: form,
    redirect: "manual",
    signal: AbortSignal.timeout(30000),
  });

  jar.absorb(res.headers.getSetCookie?.() ?? []);
  const location = res.headers.get("location") ?? "";
  const errorCode = /\/login\?error=([a-z_]+)/.exec(location)?.[1];
  const ok = jar.has("pacemate_session") && !errorCode;

  return {
    ok,
    jar,
    status: res.status,
    location,
    error: errorCode ?? (jar.has("pacemate_session") ? null : "no_session_cookie"),
    cookieNames: jar.names(),
  };
}

export { invokeServerAction };
