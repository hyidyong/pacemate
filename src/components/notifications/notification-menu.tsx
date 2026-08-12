"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, Check } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { markNotificationAsRead } from "@/services/notifications.actions";
import type { UserNotification } from "@/types/notifications";

type NotificationMenuProps = {
  notifications: UserNotification[];
  unreadCount: number;
  profileId: string;
  /** Only one responsive header instance owns the shared Realtime channel. */
  enableRealtime?: boolean;
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

function dedupeMenuNotifications(items: UserNotification[]) {
  const seenSystemBroadcasts = new Set<string>();
  const deduped: UserNotification[] = [];

  for (const item of newestFirst(items)) {
    if (item.category !== "system") {
      deduped.push(item);
      continue;
    }

    const signature = [item.category, item.title, item.body, item.target_href].join("::");
    if (seenSystemBroadcasts.has(signature)) {
      continue;
    }

    seenSystemBroadcasts.add(signature);
    deduped.push(item);
  }

  return deduped;
}

function safeNotificationTargetHref(value: string) {
  const targetHref = value.trim();
  const hasInternalPathShape = targetHref.startsWith("/") && !targetHref.startsWith("//");
  const hasForbiddenScheme = /[a-z][a-z\d+.-]*:/i.test(targetHref);

  if (!hasInternalPathShape || targetHref.includes("\\") || hasForbiddenScheme) {
    return "/notifications";
  }

  return targetHref;
}

export function NotificationMenu({
  notifications,
  unreadCount,
  profileId,
  enableRealtime = false,
}: NotificationMenuProps) {
  const router = useRouter();
  const channelInstanceId = useId().replaceAll(":", "");
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(() => dedupeMenuNotifications(notifications));
  const [toast, setToast] = useState<UserNotification | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [, startTransition] = useTransition();
  const unread = items.filter((item) => !item.is_read).length;

  useEffect(() => setItems(dedupeMenuNotifications(notifications)), [notifications]);
  useEffect(() => {
    // Both desktop and mobile headers stay mounted for responsive CSS, so only
    // the desktop instance should subscribe and surface live toasts.
    if (!enableRealtime || !profileId) return;

    // Realtime evaluates RLS as the role the SOCKET authenticates with, which
    // is not automatically the role the HTTP client uses. Hand it the current
    // access token before subscribing, and again whenever the session changes,
    // so a refresh does not silently downgrade the channel to `anon`.
    let cancelled = false;
    const authorise = async () => {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (token) supabase.realtime.setAuth(token);
    };
    void authorise();
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return;
      if (session?.access_token) supabase.realtime.setAuth(session.access_token);
    });

    const channel = supabase
      .channel(`in-app-notifications:${profileId}:${channelInstanceId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "user_notifications", filter: `recipient_id=eq.${profileId}` }, (payload) => {
        const next = asNotification(payload.new as Record<string, unknown>);
        if (!next) return;
        setItems((current) =>
          dedupeMenuNotifications([next, ...current.filter((item) => item.id !== next.id)]).slice(0, 20),
        );
        setToast(next);
      })
      .subscribe();
    return () => {
      cancelled = true;
      authListener?.subscription?.unsubscribe();
      supabase.removeChannel(channel);
    };
  }, [channelInstanceId, enableRealtime, profileId]);
  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  // The dropdown could only be dismissed by clicking the bell again —
  // Escape and outside clicks now close it (Stage 4, audit D-20).
  useEffect(() => {
    if (!open) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("mousedown", closeOnOutsideClick);
    };
  }, [open]);

  function openNotification(item: UserNotification) {
    setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, is_read: true } : entry));
    setOpen(false);
    startTransition(() => markNotificationAsRead(item.id));
    router.push(safeNotificationTargetHref(item.target_href));
  }

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="header-action-link header-icon-link notification-menu-link"
        aria-expanded={open}
        aria-label={unread ? `알림, 읽지 않음 ${unread}개` : "알림"}
      >
        <span className="notification-menu-icon">
          <Bell aria-hidden="true" />
          {unread ? <strong className="h-2.5 w-2.5 rounded-full bg-rose-400 text-transparent">새 알림</strong> : null}
        </span>
      </button>
      {open ? (
        <div className="absolute right-0 top-full z-[200] mt-3 w-[min(20rem,calc(100vw-2rem))] rounded-3xl bg-white p-3 shadow-lg ring-1 ring-slate-100">
          <div className="flex items-center justify-between px-2 pb-2">
            <strong className="text-sm text-slate-800">알림 센터</strong>
            <Link className="text-xs font-semibold text-emerald-600" href="/notifications">
              모두 보기
            </Link>
          </div>
          <div className="max-h-80 space-y-1 overflow-y-auto">
            {items.slice(0, 6).map((item) => (
              <button
                key={item.id}
                onClick={() => openNotification(item)}
                className="flex w-full items-start gap-3 rounded-2xl bg-slate-50 px-3 py-3 text-left transition hover:bg-rose-50"
                type="button"
              >
                {/* The unread dot rendered unconditionally — every item
                    looked unread (Stage 4, audit A-30). */}
                <span
                  className={`mt-1 h-2 w-2 shrink-0 rounded-full ${item.is_read ? "bg-slate-200" : "bg-rose-400"}`}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1">
                  <strong className="block truncate text-sm text-slate-800">{item.title}</strong>
                  <span className="mt-1 block line-clamp-2 text-xs leading-5 text-slate-500">{item.body}</span>
                </span>
                {item.is_read ? <Check size={15} className="text-emerald-500" aria-label="읽음" /> : null}
              </button>
            ))}
            {!items.length ? <p className="px-3 py-8 text-center text-sm text-slate-400">표시할 알림이 없습니다.</p> : null}
          </div>
        </div>
      ) : null}
      {toast ? (
        <div role="status" className="fixed left-1/2 top-5 z-[300] w-[min(92vw,420px)] -translate-x-1/2 rounded-3xl bg-white px-5 py-4 shadow-lg ring-1 ring-slate-100">
          <p className="text-xs font-bold text-rose-500">새로운 알림</p>
          <strong className="mt-1 block text-sm text-slate-900">{toast.title}</strong>
          <p className="mt-1 text-sm text-slate-500">{toast.body}</p>
        </div>
      ) : null}
    </div>
  );
}
