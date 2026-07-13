import Link from "next/link";
import {
  Bell,
  CalendarCheck,
  CheckCheck,
  ChevronRight,
  CircleHelp,
  ClipboardPenLine,
  MessageSquareText,
  Sparkles,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import {
  markAllNotificationsRead,
  markNotificationReadAndGo,
} from "@/services/notifications.actions";
import {
  getNotificationsForProfile,
  notificationCategoryLabels,
  type NotificationCategoryFilter,
  type UserNotification,
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
  question: "학생 질문 답변 요청",
  counseling: "상담 신청과 승인",
  revision: "로드맵 수정과 반영",
  system: "문의와 운영 안내",
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

function formatDate(value: string) {
  const date = new Date(value);
  return `${date.getFullYear()}. ${date.getMonth() + 1}. ${date.getDate()}. ${String(
    date.getHours(),
  ).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function categoryHref(category: NotificationCategoryFilter) {
  return category === "all" ? "/notifications" : `/notifications?category=${category}`;
}

function formatRelativeDate(value: string) {
  const now = new Date();
  const date = new Date(value);
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.max(0, Math.floor(diffMs / 60000));

  if (diffMinutes < 1) {
    return "방금 전";
  }

  if (diffMinutes < 60) {
    return `${diffMinutes}분 전`;
  }

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}시간 전`;
  }

  return `${date.getMonth() + 1}월 ${date.getDate()}일`;
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
            <p>질문, 상담, 로드맵 수정 요청을 놓치지 않게 모아 보여줘요.</p>
          </div>
          <form action={markAllNotificationsRead}>
            <Button type="submit" variant="outline">
              전체 읽음
              <CheckCheck size={16} aria-hidden="true" />
            </Button>
          </form>
          <Link href="/notifications/settings" className="rounded-md border px-4 py-2 text-sm font-semibold">알림 설정</Link>
        </div>

        <div className="notifications-summary-card">
          <span>
            <Sparkles size={16} aria-hidden="true" />
            새로 확인할 알림
          </span>
          <strong>{totalUnreadCount}개</strong>
          <p>알림을 누르면 읽음 처리 후 관련 화면으로 바로 이동합니다.</p>
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
            <div className="notifications-list">
              {notifications.map((notification) => (
                <NotificationRow notification={notification} key={notification.id} />
              ))}
            </div>
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

function NotificationRow({ notification }: { notification: UserNotification }) {
  const Icon = categoryIcons[notification.category];

  return (
    <form action={markNotificationReadAndGo}>
      <input type="hidden" name="notificationId" value={notification.id} />
      <button className="notification-row" data-unread={!notification.is_read} type="submit">
        <span className="notification-row-icon">
          <Icon size={18} aria-hidden="true" />
        </span>
        <div>
          <span className="notification-row-meta">
            {notificationCategoryLabels[notification.category]}
            {!notification.is_read ? <i>새 알림</i> : null}
          </span>
          <strong>{notification.title}</strong>
          <p>{notification.body}</p>
          <small>
            {formatRelativeDate(notification.created_at)} · {formatDate(notification.created_at)}
          </small>
        </div>
        <span className="notification-row-action">
          열기
          <ChevronRight aria-hidden="true" />
        </span>
      </button>
    </form>
  );
}
