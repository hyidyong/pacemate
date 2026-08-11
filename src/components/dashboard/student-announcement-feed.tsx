"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bell, X } from "lucide-react";

export type StudentAnnouncement = {
  id: string;
  title: string;
  content: string;
  courseName: string | null;
  href: string;
  createdAt: string | null;
};

const storageKey = "pacemate.dismissed-course-notices.v1";

function readDismissedIds() {
  if (typeof window === "undefined") return new Set<string>();
  try {
    const value = JSON.parse(window.localStorage.getItem(storageKey) ?? "[]");
    return new Set(Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set<string>();
  }
}

export function filterVisibleAnnouncements<T extends { id: string }>(announcements: T[], dismissedIds: Set<string>) {
  return announcements.filter((announcement) => !dismissedIds.has(announcement.id));
}

export function StudentAnnouncementFeed({ announcements }: { announcements: StudentAnnouncement[] }) {
  const [dismissedIds, setDismissedIds] = useState(new Set<string>());

  useEffect(() => {
    setDismissedIds(readDismissedIds());
  }, []);

  const visible = filterVisibleAnnouncements(announcements, dismissedIds);

  function dismiss(id: string) {
    setDismissedIds((current) => {
      const next = new Set(current).add(id);
      window.localStorage.setItem(storageKey, JSON.stringify([...next]));
      return next;
    });
  }

  if (!visible.length) return null;

  return (
    <section className="mt-4 rounded-2xl bg-slate-50 p-4 shadow-sm" aria-label="공지사항">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-bold text-slate-800"><Bell size={16} />공지사항</div>
        <Link className="text-xs font-semibold text-emerald-700" href="/notices">전체 보기</Link>
      </div>
      <div className="space-y-2">
        {visible.slice(0, 3).map((notice) => (
          <article className="flex items-start gap-3 rounded-xl bg-white px-3 py-3 shadow-sm" key={notice.id}>
            <Link className="min-w-0 flex-1" href={notice.href}>
              <p className="truncate text-sm font-semibold text-slate-800">{notice.title}</p>
              <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{notice.content}</p>
              {notice.courseName ? <span className="mt-1 block text-[11px] font-medium text-emerald-700">{notice.courseName}</span> : null}
            </Link>
            <button aria-label={`${notice.title} 닫기`} className="shrink-0 rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700" onClick={() => dismiss(notice.id)} type="button"><X size={16} /></button>
          </article>
        ))}
      </div>
    </section>
  );
}
