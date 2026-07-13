import { AppShell } from "@/components/layout/app-shell";
import { NotificationPreferencesPanel } from "@/components/notifications/notification-preferences-panel";
import { getDemoProfile } from "@/services/session.service";
import { redirect } from "next/navigation";

export default async function NotificationSettingsPage() {
  if (!(await getDemoProfile())) redirect("/login");
  return <AppShell><section className="notifications-app"><div className="notifications-topbar"><div><h1>알림 환경설정</h1><p>브라우저 알림과 방해금지 시간을 직접 관리합니다.</p></div></div><NotificationPreferencesPanel /></section></AppShell>;
}
