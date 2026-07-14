import Link from "next/link";
import {
  Bell,
  CalendarCheck,
  CheckCheck,
  CircleHelp,
  ClipboardPenLine,
  MessageSquareText,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { NotificationList } from "@/components/notifications/notification-list";
import { Button } from "@/components/ui/button";
import { markAllNotificationsRead } from "@/services/notifications.actions";
import {
  getNotificationsForProfile,
  notificationCategoryLabels,
  type NotificationCategoryFilter,
} from "@/services/notifications.service";
import { getDemoProfile } from "@/services/session.service";

const categories: NotificationCategoryFilter[] = [
  "all",
  "question",
  "counseling",
  "revision",
  "system",
];

const categoryDescriptions: Record<NotificationCategoryFilter, string> = {
  all: "전체 알림",
  question: "학생 질문과 답변 알림",
  counseling: "상담 신청과 일정 알림",
  revision: "로드맵 수정과 반영 알림",
  system: "운영 공지와 시스템 알림",
};

const categoryIcons = {
  all: Bell,
  question: MessageSquareText,
  counseling: CalendarCheck,
  revision: ClipboardPenLine,
  system: CircleHelp,
} satisfies Record<NotificationCategoryFilter, LucideIcon>;

type NotificationsPageProps = {
  searchParams: Promise<{
    category?: string;
  }>;
};

export const dynamic = "force-dynamic";

function asCategory(value?: string): NotificationCategoryFilter {
  return categories.includes(value as NotificationCategoryFilter)
    ? (value as NotificationCategoryFilter)
    : "all";
}

function categoryHref(category: NotificationCategoryFilter) {
  return category === "all" ? "/notifications" : `/notifications?category=${category}`;
}

export default async function NotificationsPage({
  searchParams,
}: NotificationsPageProps) {
  const profile = await getDemoProfile();
  const { category: categoryParam } = await searchParams;
  const activeCategory = asCategory(categoryParam);
  const notifications = await getNotificationsForProfile(profile, 80, activeCategory);
  const unreadCount = notifications.filter((notification) => !notification.is_read).length;
  const totalNotifications = await getNotificationsForProfile(profile, 80, "all");
  const totalUnreadCount = totalNotifications.filter((notification) => !notification.is_read).length;

  return (
    <AppShell>
      <section className="notifications-app">
        <div className="notifications-topbar">
          <div>
            <span className="notifications-kicker">
              <Bell size={15} aria-hidden="true" />
              알림함
            </span>
            <h1>지금 확인할 알림</h1>
            <p>질문, 상담, 로드맵, 운영 알림을 한 곳에서 바로 열어볼 수 있어요.</p>
          </div>
          <form action={markAllNotificationsRead}>
            <Button type="submit" variant="outline">
              전체 읽음
              <CheckCheck size={16} aria-hidden="true" />
            </Button>
          </form>
          <Link href="/notifications/settings" className="rounded-md border px-4 py-2 text-sm font-semibold">
            알림 설정
          </Link>
        </div>

        <div className="notifications-summary-card">
          <span>
            <Sparkles size={16} aria-hidden="true" />
            새로 확인할 알림
          </span>
          <strong>{totalUnreadCount}개</strong>
          <p>알림을 누르면 읽음 처리와 함께 관련 화면으로 바로 이동합니다.</p>
        </div>

        <nav className="notifications-category-rail" aria-label="알림 카테고리">
          {categories.map((category) => {
            const Icon = categoryIcons[category];

            return (
              <Link
                data-active={activeCategory === category}
                href={categoryHref(category)}
                key={category}
              >
                <Icon size={17} aria-hidden="true" />
                <span>{notificationCategoryLabels[category]}</span>
              </Link>
            );
          })}
        </nav>

        <section className="notifications-list-panel">
          <div className="notifications-list-heading">
            <div>
              <span>{categoryDescriptions[activeCategory]}</span>
              <h2>{notificationCategoryLabels[activeCategory]}</h2>
              <p>
                {notifications.length}개 알림 · 안 읽음 {unreadCount}개
              </p>
            </div>
          </div>

          {notifications.length ? (
            <NotificationList initialNotifications={notifications} />
          ) : (
            <div className="community-empty">
              <Bell aria-hidden="true" />
              <p>이 카테고리에는 아직 알림이 없습니다.</p>
            </div>
          )}
        </section>
      </section>
    </AppShell>
  );
}
