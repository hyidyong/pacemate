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

// The action's return value is embedded in the RSC Flight payload. The app's
// actions all return { ok, message }, so the message text is the observable
// outcome; classify it without needing a Flight parser.
export function classifyBookingResponse(body) {
  if (/상담 신청을 보냈습니다/.test(body)) return "booked";
  if (/이미 신청된 상담 시간입니다/.test(body)) return "duplicate_ack";
  if (/선택한 상담 시간을 예약할 수 없습니다/.test(body)) return "slot_conflict";
  if (/상담 신청을 저장하지 못했습니다/.test(body)) return "storage_failure";
  if (/알림 전송에 실패했습니다/.test(body)) return "booked_notify_failed";
  if (/로그인한 학생만/.test(body)) return "not_student";
  return "unknown";
}

export function classifyCancelResponse(body) {
  if (/상담 신청을 취소했습니다/.test(body)) return "cancelled";
  if (/취소할 수 없는 상담 신청입니다/.test(body)) return "cancel_conflict";
  if (/취소하지 못했습니다/.test(body)) return "cancel_failure";
  return "unknown";
}
