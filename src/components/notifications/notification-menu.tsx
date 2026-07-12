import Link from "next/link";
import { Bell } from "lucide-react";
import type { UserNotification } from "@/types/notifications";

type NotificationMenuProps = {
  notifications: UserNotification[];
  unreadCount: number;
};

export function NotificationMenu({
  unreadCount,
}: NotificationMenuProps) {
  return (
    <Link
      className="header-action-link header-icon-link notification-menu-link"
      href="/notifications"
      aria-label={`알림함으로 이동${unreadCount > 0 ? `, 안 읽은 알림 ${unreadCount}개` : ""}`}
    >
      <span className="notification-menu-icon">
        <Bell aria-hidden="true" />
        {unreadCount > 0 ? <strong>{unreadCount > 9 ? "9+" : unreadCount}</strong> : null}
      </span>
      <span className="sr-only">알림함</span>
    </Link>
  );
}
