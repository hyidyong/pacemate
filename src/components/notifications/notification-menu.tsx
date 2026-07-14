"use client";

import { useEffect, useId, useState, useTransition } from "react";
import Link from "next/link";
import { Bell, Check } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { markNotificationAsRead } from "@/services/notifications.actions";
import type { UserNotification } from "@/types/notifications";

type NotificationMenuProps = {
  notifications: UserNotification[];
  unreadCount: number;
  profileId: string;
};

function asNotification(value: Record<string, unknown>): UserNotification | null {
  return typeof value.id === "string" && typeof value.title === "string" && typeof value.body === "string"
    && typeof value.target_href === "string" && typeof value.created_at === "string"
    && typeof value.is_read === "boolean" && (value.recipient_role === null || typeof value.recipient_role === "string")
    && (value.target_group === "ALL" || value.target_group === "STUDENT" || value.target_group === "PROFESSOR")
    && (value.category === "question" || value.category === "counseling" || value.category === "revision" || value.category === "system")
    ? value as UserNotification
    : null;
}

function newestFirst(items: UserNotification[]) {
  return [...items].sort((left, right) =>
    new Date(right.created_at).getTime() - new Date(left.created_at).getTime(),
  );
}

export function NotificationMenu({ notifications, unreadCount, profileId }: NotificationMenuProps) {
  const channelInstanceId = useId().replaceAll(":", "");
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(notifications);
  const [toast, setToast] = useState<UserNotification | null>(null);
  const [, startTransition] = useTransition();
  const unread = items.filter((item) => !item.is_read).length;

  useEffect(() => setItems(newestFirst(notifications)), [notifications]);
  useEffect(() => {
    if (!profileId) return;

    const channel = supabase
      .channel(`in-app-notifications:${profileId}:${channelInstanceId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "user_notifications", filter: `recipient_id=eq.${profileId}` }, (payload) => {
        const next = asNotification(payload.new as Record<string, unknown>);
        if (!next) return;
        setItems((current) => newestFirst([next, ...current.filter((item) => item.id !== next.id)]).slice(0, 20));
        setToast(next);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [channelInstanceId, profileId]);
  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  function markRead(id: string) {
    setItems((current) => current.map((item) => item.id === id ? { ...item, is_read: true } : item));
    startTransition(() => markNotificationAsRead(id));
  }

  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((value) => !value)} className="header-action-link header-icon-link notification-menu-link" aria-expanded={open} aria-label={`알림 ${unread ? `읽지 않음 ${unread}개` : ""}`}>
        <span className="notification-menu-icon">
          <Bell aria-hidden="true" />
          {unread ? <strong className="h-2.5 w-2.5 rounded-full bg-rose-400 text-transparent">새 알림</strong> : null}
        </span>
        <span className="sr-only">알림</span>
      </button>
      {open ? (
        <div className="absolute right-0 top-full z-[200] mt-3 w-80 rounded-3xl bg-white p-3 shadow-lg ring-1 ring-slate-100">
          <div className="flex items-center justify-between px-2 pb-2"><strong className="text-sm text-slate-800">알림 센터</strong><Link className="text-xs font-semibold text-emerald-600" href="/notifications">모두 보기</Link></div>
          <div className="max-h-80 space-y-1 overflow-y-auto">
            {items.slice(0, 6).map((item) => (
              <button key={item.id} onClick={() => markRead(item.id)} className="flex w-full items-start gap-3 rounded-2xl bg-slate-50 px-3 py-3 text-left transition hover:bg-rose-50" type="button">
                <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-rose-400" aria-hidden="true" />
                <span className="min-w-0 flex-1"><strong className="block truncate text-sm text-slate-800">{item.title}</strong><span className="mt-1 block line-clamp-2 text-xs leading-5 text-slate-500">{item.body}</span></span>
                {item.is_read ? <Check size={15} className="text-emerald-500" aria-label="읽음" /> : null}
              </button>
            ))}
            {!items.length ? <p className="px-3 py-8 text-center text-sm text-slate-400">새 알림이 없습니다.</p> : null}
          </div>
        </div>
      ) : null}
      {toast ? <div className="fixed left-1/2 top-5 z-[300] w-[min(92vw,420px)] -translate-x-1/2 rounded-3xl bg-white px-5 py-4 shadow-lg ring-1 ring-slate-100"><p className="text-xs font-bold text-rose-500">띠롱! 새 알림</p><strong className="mt-1 block text-sm text-slate-900">{toast.title}</strong><p className="mt-1 text-sm text-slate-500">{toast.body}</p></div> : null}
    </div>
  );
}
