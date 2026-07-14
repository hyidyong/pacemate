"use client";

import { CalendarDays, CheckSquare, LayoutGrid, MessageSquare } from "lucide-react";

export type MyPageSection = "all" | "timetable" | "todo" | "community";

export function shouldRenderMyPageSection(active: MyPageSection, section: Exclude<MyPageSection, "all">) {
  return active === "all" || active === section;
}

const tabs = [
  { id: "all", label: "전체", icon: LayoutGrid },
  { id: "timetable", label: "시간표", icon: CalendarDays },
  { id: "todo", label: "투두", icon: CheckSquare },
  { id: "community", label: "커뮤니티", icon: MessageSquare },
] as const;

export function MyPageSectionTabs({ activeTab, onChange }: { activeTab: MyPageSection; onChange: (tab: MyPageSection) => void }) {
  return <div className="mb-5 flex items-center justify-around rounded-2xl bg-white/80 p-2 shadow-sm" aria-label="마이페이지 섹션">
    {tabs.map(({ id, label, icon: Icon }) => <button aria-label={label} aria-pressed={activeTab === id} className={`inline-flex h-10 w-10 items-center justify-center rounded-xl transition ${activeTab === id ? "bg-blue-50 text-blue-600 shadow-sm" : "bg-transparent text-gray-400 hover:bg-gray-50 hover:text-gray-600"}`} key={id} onClick={() => onChange(id)} type="button"><Icon size={20} /></button>)}
  </div>;
}
