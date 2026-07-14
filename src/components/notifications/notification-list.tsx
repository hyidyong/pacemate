"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Bell,
  CalendarCheck,
  ChevronRight,
  CircleHelp,
  ClipboardPenLine,
  MessageSquareText,
  type LucideIcon,
} from "lucide-react";
import { markNotificationAsRead } from "@/services/notifications.actions";
import { notificationCategoryLabels, type UserNotification } from "@/types/notifications";

const categoryIcons = {
  all: Bell,
  question: MessageSquareText,
  counseling: CalendarCheck,
  revision: ClipboardPenLine,
  system: CircleHelp,
} satisfies Record<"all" | UserNotification["category"], LucideIcon>;

function safeNotificationTargetHref(value: string) {
  const targetHref = value.trim();
  const hasInternalPathShape = targetHref.startsWith("/") && !targetHref.startsWith("//");
  const hasForbiddenScheme = /[a-z][a-z\d+.-]*:/i.test(targetHref);

  if (!hasInternalPathShape || targetHref.includes("\\") || hasForbiddenScheme) {
    return "/notifications";
  }

  return targetHref;
}

function formatDate(value: string) {
  const date = new Date(value);
  return `${date.getFullYear()}. ${date.getMonth() + 1}. ${date.getDate()}. ${String(
    date.getHours(),
  ).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
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

export function NotificationList({ initialNotifications }: { initialNotifications: UserNotification[] }) {
  const router = useRouter();
  const [notifications, setNotifications] = useState(initialNotifications);
  const [isPending, startTransition] = useTransition();

  function handleOpen(notification: UserNotification) {
    const href = safeNotificationTargetHref(notification.target_href);
    if (!notification.is_read) {
      setNotifications((current) =>
        current.map((item) => (item.id === notification.id ? { ...item, is_read: true } : item)),
      );
      startTransition(() => markNotificationAsRead(notification.id));
    }
    router.push(href);
  }

  return (
    <div className="notifications-list">
      {notifications.map((notification) => {
        const Icon = categoryIcons[notification.category];

        return (
          <button
            className="notification-row"
            data-unread={!notification.is_read}
            disabled={isPending}
            key={notification.id}
            onClick={() => handleOpen(notification)}
            type="button"
          >
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
        );
      })}
    </div>
  );
}
