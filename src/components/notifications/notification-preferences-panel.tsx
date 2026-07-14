"use client";

/**
 * Notifications intentionally stay in-app. Broadcast delivery is handled by
 * the realtime notification menu, so this screen never asks the browser for
 * notification permission or uses the native Notification API.
 */
export function NotificationPreferencesPanel() {
  return (
    <section
      aria-labelledby="in-app-notification-settings"
      className="rounded-3xl bg-slate-50 p-6 shadow-md"
    >
      <h2 id="in-app-notification-settings" className="text-lg font-bold text-slate-900">
        앱 내 알림
      </h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        관리자가 보낸 알림은 헤더의 알림함과 알림 페이지에서 바로 확인할 수 있습니다.
        브라우저 알림 권한은 요청하지 않습니다.
      </p>
    </section>
  );
}
