import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Next.js App Router server actions are POSTs to the page URL the action is bound
// on, carrying a build-specific action id in the `Next-Action` header. The ids
// live in the build's server-reference-manifest, so the harness re-reads them
// after every `next build` instead of hard-coding anything.
export function loadActionIds(root = process.cwd()) {
  const manifestPath = resolve(root, ".next/server/server-reference-manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const byExportName = new Map();

  for (const [actionId, entry] of Object.entries(manifest.node ?? {})) {
    const exported = entry.exportedName;
    const filename = entry.filename ?? "";
    if (!exported) continue;
    const key = `${basename(filename)}#${exported}`;
    byExportName.set(key, actionId);
    if (!byExportName.has(exported)) byExportName.set(exported, actionId);
  }

  return {
    get(exportedName) {
      const id = byExportName.get(exportedName);
      if (!id) {
        throw new Error(
          `Server action "${exportedName}" not found in server-reference-manifest.json — rebuild with \`npm run build\`.`,
        );
      }
      return id;
    },
    size: byExportName.size,
  };
}

function basename(path) {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] ?? path;
}

// Invoke a server action over HTTP exactly as the browser client does.
export async function invokeServerAction({
  baseUrl,
  pagePath,
  actionId,
  fields,
  cookie,
  timeoutMs = 30000,
}) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    form.set(key, value);
  }
  // Progressive-enhancement encoding: the action id rides in the body as
  // $ACTION_ID_*. This is the same path a JS-disabled browser uses and, unlike
  // the Next-Action header form, it yields ordinary HTTP responses (303 +
  // Set-Cookie) that a harness can read without a Flight parser.
  form.set(`$ACTION_ID_${actionId}`, "");

  const res = await fetch(`${baseUrl}${pagePath}`, {
    method: "POST",
    headers: {
      cookie,
      // Next 15 rejects server actions whose Origin does not match Host.
      Origin: baseUrl,
      "accept-language": "ko-KR",
    },
    body: form,
    redirect: "manual",
    signal: AbortSignal.timeout(timeoutMs),
  });

  const body = await res.text();
  return { status: res.status, body, ok: res.status >= 200 && res.status < 400 };
}

// NOTE ON OUTCOME CLASSIFICATION
//
// The progressive-enhancement encoding re-renders the page rather than
// returning the action's { ok, message } result, and the Next-Action header
// encoding is rejected by this Next build when driven from outside the client
// runtime (HTTP 500, digest 1795915146). Outcomes are therefore derived from
// the resulting DATABASE STATE, which is what the Stage 5 invariants are about
// anyway — an HTTP 200 was never sufficient evidence. These helpers remain for
// the paths where the rendered page does carry the text.
export function bodyMentionsStorageFailure(body) {
  return /상담 신청을 저장하지 못했습니다/.test(body);
}
