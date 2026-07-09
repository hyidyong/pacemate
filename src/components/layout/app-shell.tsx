import Link from "next/link";
import { Bot, BookOpenText, CalendarClock, House, MessagesSquare, Sparkles, UserCircle2 } from "lucide-react";
import { AppHeader } from "@/components/layout/app-header";
import { MobileBottomNav } from "@/components/layout/mobile-bottom-nav";
import {
  getNotificationsForProfile,
  getUnreadNotificationCount,
} from "@/services/notifications.service";
import { getDemoProfile, getRoleHomePath } from "@/services/session.service";

type AppShellProps = {
  children: React.ReactNode;
};

export async function AppShell({ children }: AppShellProps) {
  const profile = await getDemoProfile();
  const [notifications, unreadCount] = await Promise.all([
    getNotificationsForProfile(profile, 5),
    getUnreadNotificationCount(profile),
  ]);
  const isAuthenticated = Boolean(profile);
  const isProfessor = profile?.role === "professor";
  const isOperator = profile?.role === "assistant" || profile?.role === "admin";
  const isStudent = isAuthenticated && !isProfessor && !isOperator;
  const homeHref = profile ? getRoleHomePath(profile.role) : "/";
  const professorMobileNavItems = [
    { label: "홈", href: "/professor", icon: House },
    { label: "과목 관리", href: "/professor?tab=roadmap&sub=roadmap-edit", icon: BookOpenText },
    { label: "일정관리", href: "/professor?tab=schedule&sub=calendar", icon: CalendarClock },
    { label: "마이페이지", href: "/mypage", icon: UserCircle2 },
    { label: "커뮤니티", href: "/professor/lounge", icon: MessagesSquare },
  ];

  return (
    <div className="app-shell">
      <AppHeader
        isAuthenticated={isAuthenticated}
        isProfessor={isProfessor}
        isOperator={isOperator}
        homeHref={homeHref}
        notifications={notifications}
        unreadCount={unreadCount}
      />

      {/* 학생/교수: 모바일 하단바 높이만큼 padding */}
      <main className={isStudent || isProfessor ? "pb-[60px] md:pb-0" : ""}>{children}</main>

      {/* 학생 전용 하단 탭바 (모바일만) */}
      {isStudent && <MobileBottomNav />}

      {/* 교수 전용 모바일 하단바 */}
      {isAuthenticated && isProfessor && (
        <nav
          className="md:hidden fixed bottom-0 left-0 right-0 z-50 border-t border-gray-100 bg-white/90 backdrop-blur-md"
          aria-label="Professor mobile navigation"
        >
          <div className="mx-auto flex h-[60px] max-w-4xl items-center justify-around px-2">
            {professorMobileNavItems.map(({ label, href, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className="flex min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1 text-[11px] font-medium text-gray-400 transition-colors hover:text-emerald-600"
              >
                <Icon size={18} />
                <span className="leading-none">{label}</span>
              </Link>
            ))}
          </div>
        </nav>
      )}

      {/* 운영자 전용 단순 모바일 하단바 */}
      {isAuthenticated && isOperator && !isProfessor && (
        <nav
          className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-white/90 backdrop-blur-md border-t border-gray-100 flex items-center justify-around h-[60px]"
          aria-label="Operator mobile navigation"
        >
          <Link
            href="/admin"
            className="flex flex-col items-center gap-1 text-gray-400 hover:text-emerald-600 transition-colors"
          >
            <span className="text-[11px] font-medium">운영 홈</span>
          </Link>
        </nav>
      )}

      {/* AI 튜터 FAB — 학생 전용 데스크톱에서만 표시 */}
      {isStudent && (
        <div className="hidden md:block fixed bottom-10 right-10 z-[100] group">
          <div className="absolute bottom-full right-0 mb-4 w-48 bg-white/95 backdrop-blur-sm text-gray-800 text-xs rounded-xl shadow-2xl p-3.5 border border-emerald-100 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none">
            <div className="font-bold text-emerald-600 mb-1 flex items-center gap-1">
              <Sparkles size={14} /> AI 튜터 대기 중!
            </div>
            어려운 문제가 있나요? 언제든 편하게 물어보세요!
            <div className="absolute -bottom-2 right-4 w-4 h-4 bg-white border-b border-r border-emerald-100 transform rotate-45" />
          </div>
          <Link
            href="/chatbot"
            className="flex items-center justify-center w-14 h-14 bg-gradient-to-tr from-emerald-600 to-teal-500 text-white rounded-full shadow-[0_8px_30px_rgba(16,185,129,0.4)] hover:shadow-[0_12px_40px_rgba(16,185,129,0.6)] hover:scale-110 transition-all duration-300"
          >
            <Bot size={28} strokeWidth={2.5} className="fab-bot-icon" />
          </Link>
        </div>
      )}
    </div>
  );
}
