"use client";

import { useState } from "react";
import Link from "next/link";
import { Bell, X } from "lucide-react";
import type { StudentAnnouncement } from "@/components/dashboard/student-announcement-feed";

export function StudentAnnouncementBanner({ announcement }: { announcement: StudentAnnouncement | null }) {
  const [visible, setVisible] = useState(Boolean(announcement));
  if (!announcement || !visible) return null;
  return <aside className="mb-5 flex items-start gap-3 rounded-2xl bg-amber-50 px-4 py-3 shadow-sm" aria-label="최신 공지"><Bell className="mt-0.5 shrink-0 text-amber-700" size={18} /><Link className="min-w-0 flex-1" href={announcement.href}><p className="truncate text-sm font-bold text-amber-950">{announcement.title}</p><p className="mt-1 line-clamp-1 text-xs text-amber-800">{announcement.content}</p></Link><button aria-label="공지 닫기" className="-m-1.5 shrink-0 rounded-full p-2.5 text-amber-700 hover:bg-amber-100" onClick={() => setVisible(false)} type="button"><X size={16} /></button></aside>;
}
