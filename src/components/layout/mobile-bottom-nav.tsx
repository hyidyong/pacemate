"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Map, MessageCircle, User } from "lucide-react";

const tabs = [
  { href: "/dashboard", label: "홈", icon: Home },
  { href: "/roadmap", label: "로드맵", icon: Map },
  { href: "/chatbot", label: "AI 채팅", icon: MessageCircle },
  { href: "/mypage", label: "마이페이지", icon: User },
] as const;

export function MobileBottomNav() {
  const pathname = usePathname();

  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-white/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-14px_34px_rgba(23,32,26,0.09)] backdrop-blur-md"
      aria-label="Mobile primary navigation"
    >
      <div className="grid grid-cols-4 h-[64px]">
        {tabs.map(({ href, label, icon: Icon }) => {
          const isActive = pathname === href || (href !== "/dashboard" && pathname.startsWith(href));
          return (
            <Link
              key={href}
              href={href}
              className="relative flex flex-col items-center justify-center gap-0.5 transition-colors"
              aria-current={isActive ? "page" : undefined}
            >
              {/* Active indicator pill */}
              {isActive && (
                <span className="absolute top-0 left-1/2 h-0.5 w-8 -translate-x-1/2 rounded-full bg-emerald-500" />
              )}
              <Icon
                size={22}
                strokeWidth={isActive ? 2.5 : 1.7}
                className={isActive ? "text-emerald-600" : "text-gray-400"}
                aria-hidden="true"
              />
              <span
                className={`text-[10px] font-medium ${isActive ? "text-emerald-600" : "text-gray-400"}`}
              >
                {label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
