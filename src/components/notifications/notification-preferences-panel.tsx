"use client";

import { useEffect, useState } from "react";
import {
  browserNotificationCategories,
  normalizeNotificationPreferences,
  type BrowserNotificationPreferences,
} from "@/lib/notification-preferences";

const STORAGE_KEY = "pacemate-browser-notification-preferences-v1";
const labels = { question: "질문 답변", counseling: "상담", revision: "로드맵", system: "운영 안내" } as const;

export function NotificationPreferencesPanel() {
  const [preferences, setPreferences] = useState<BrowserNotificationPreferences>(() => normalizeNotificationPreferences(null));
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");
  const [message, setMessage] = useState("");

  useEffect(() => {
    setPermission("Notification" in window ? Notification.permission : "unsupported");
    try {
      setPreferences(normalizeNotificationPreferences(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null")));
    } catch {
      setPreferences(normalizeNotificationPreferences(null));
    }
  }, []);

  function save(next: BrowserNotificationPreferences) {
    setPreferences(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setMessage("이 브라우저의 알림 설정을 저장했습니다.");
  }

  async function requestPermission() {
    if (!("Notification" in window)) {
      setPermission("unsupported");
      return;
    }
    const nextPermission = await Notification.requestPermission();
    setPermission(nextPermission);
    save({ ...preferences, browserEnabled: nextPermission === "granted" });
  }

  return (
    <section className="notifications-list-panel" aria-labelledby="browser-notification-settings">
      <h2 id="browser-notification-settings">브라우저 알림 설정</h2>
      <p className="mt-2 text-sm text-gray-600">버튼을 누를 때만 브라우저 권한을 요청합니다. 브라우저 알림을 꺼도 앱 안의 알림함은 계속 사용할 수 있습니다.</p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" onClick={requestPermission} className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white">
          {permission === "granted" ? "권한 허용됨" : permission === "denied" ? "브라우저에서 차단됨" : "브라우저 알림 권한 요청"}
        </button>
        <span className="text-sm text-gray-500">실제 원격 push 전송은 배포용 VAPID 설정 후 활성화됩니다.</span>
      </div>
      <fieldset className="mt-5 grid gap-2 sm:grid-cols-2">
        <legend className="mb-2 font-semibold">받을 알림 종류</legend>
        {browserNotificationCategories.map((category) => (
          <label key={category} className="flex items-center gap-2 rounded-lg border p-3 text-sm">
            <input
              type="checkbox"
              checked={preferences.categories.includes(category)}
              onChange={(event) => save({
                ...preferences,
                categories: event.target.checked
                  ? [...preferences.categories, category]
                  : preferences.categories.filter((item) => item !== category),
              })}
            />
            {labels[category]}
          </label>
        ))}
      </fieldset>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <label className="text-sm">방해금지 시작<input className="mt-1 block w-full rounded-md border p-2" type="time" value={preferences.quietStart} onChange={(event) => save({ ...preferences, quietStart: event.target.value })} /></label>
        <label className="text-sm">방해금지 종료<input className="mt-1 block w-full rounded-md border p-2" type="time" value={preferences.quietEnd} onChange={(event) => save({ ...preferences, quietEnd: event.target.value })} /></label>
      </div>
      {message ? <p className="mt-4 text-sm text-emerald-700" aria-live="polite">{message}</p> : null}
    </section>
  );
}
