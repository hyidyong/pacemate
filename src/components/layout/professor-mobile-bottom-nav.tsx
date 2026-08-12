"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  BookOpenText,
  CalendarClock,
  House,
  MessagesSquare,
  UserCircle2,
} from "lucide-react";

const professorMobileNavItems = [
  { id: "home", label: "홈", href: "/professor", icon: House },
  {
    id: "roadmap",
    label: "과목 관리",
    href: "/professor?tab=roadmap&sub=roadmap-edit",
    icon: BookOpenText,
  },
  {
    id: "schedule",
    label: "일정관리",
    href: "/professor?tab=schedule&sub=calendar",
    icon: CalendarClock,
  },
  { id: "community", label: "커뮤니티", href: "/professor/lounge", icon: MessagesSquare },
  { id: "mypage", label: "마이페이지", href: "/professor/mypage", icon: UserCircle2 },
] as const;

function getActiveProfessorMobileNavItem(pathname: string, tab: string | null) {
  if (pathname === "/professor/lounge" || pathname.startsWith("/professor/lounge/")) {
    return "community";
  }

  if (pathname === "/professor/mypage" || pathname.startsWith("/professor/mypage/")) {
    return "mypage";
  }

  if (pathname === "/professor" && tab === "roadmap") {
    return "roadmap";
  }

  if (pathname === "/professor" && tab === "schedule") {
    return "schedule";
  }

  return pathname === "/professor" && !tab ? "home" : null;
}

export function ProfessorMobileBottomNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeItem = getActiveProfessorMobileNavItem(pathname, searchParams.get("tab"));

  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-white/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-14px_34px_rgba(23,32,26,0.09)] backdrop-blur-md"
      aria-label="Professor mobile navigation"
    >
      <div className="grid h-[64px] grid-cols-5">
        {professorMobileNavItems.map(({ id, label, href, icon: Icon }) => {
          const isActive = activeItem === id;

          return (
            <Link
              key={id}
              href={href}
              className={`relative flex min-w-0 flex-col items-center justify-center gap-1 px-1 text-center text-[11px] font-medium leading-none transition-colors ${
                isActive ? "text-emerald-600" : "text-gray-400 hover:text-emerald-600"
              }`}
              aria-current={isActive ? "page" : undefined}
            >
              {isActive ? (
                <span
                  className="absolute top-0 h-0.5 w-8 rounded-full bg-emerald-500"
                  aria-hidden="true"
                />
              ) : null}
              <Icon size={18} strokeWidth={isActive ? 2.4 : 1.8} aria-hidden="true" />
              <span className="min-w-0 max-w-full truncate">{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
