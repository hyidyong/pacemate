import Image from "next/image";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { AppHeader } from "@/components/layout/app-header-professor-safe";
import { MobileBottomNav } from "@/components/layout/mobile-bottom-nav";
import { ProfessorMobileBottomNav } from "@/components/layout/professor-mobile-bottom-nav";
import { SiteFooter } from "@/components/layout/site-footer";
import {
  getNotificationsForProfile,
  getUnreadNotificationCount,
  type UserNotification,
} from "@/services/notifications.service";
import { getDemoProfile, getRoleHomePath, type DemoProfile } from "@/services/session.service";

type AppShellProps = {
  children: React.ReactNode;
  showAiTutorFab?: boolean;
  showSiteFooter?: boolean;
  profile?: DemoProfile | null;
  notifications?: UserNotification[];
  unreadCount?: number;
};

export async function AppShell({
  children,
  showAiTutorFab = true,
  showSiteFooter = true,
  profile,
  notifications,
  unreadCount,
}: AppShellProps) {
  const resolvedProfile = profile === undefined ? await getDemoProfile() : profile;
  const [resolvedNotifications, resolvedUnreadCount] = await Promise.all([
    notifications ?? getNotificationsForProfile(resolvedProfile, 5).catch((error) => {
      console.error("App shell notifications could not be loaded", error);
      return [];
    }),
    unreadCount ?? getUnreadNotificationCount(resolvedProfile).catch((error) => {
      console.error("App shell notification count could not be loaded", error);
      return 0;
    }),
  ]);

  const isAuthenticated = Boolean(resolvedProfile);
  const isProfessor = resolvedProfile?.role === "professor";
  const isOperator = resolvedProfile?.role === "assistant" || resolvedProfile?.role === "admin";
  const isStudent = isAuthenticated && !isProfessor && !isOperator;
  const homeHref = resolvedProfile ? getRoleHomePath(resolvedProfile.role) : "/";

  return (
    <>
      <div className="app-shell">
        <AppHeader
          isAuthenticated={isAuthenticated}
          isProfessor={isProfessor}
          isOperator={isOperator}
          homeHref={homeHref}
          notifications={resolvedNotifications}
          unreadCount={resolvedUnreadCount}
          profileId={resolvedProfile?.id ?? ""}
        />

        <main
          className={`app-shell-main${isStudent || isProfessor ? " app-shell-main--with-mobile-nav" : ""}`}
        >
          {children}
        </main>
      </div>

      {showSiteFooter ? <SiteFooter hasMobileNav={isStudent || isProfessor || isOperator} /> : null}

      {isStudent && <MobileBottomNav />}

      {isAuthenticated && isProfessor && <ProfessorMobileBottomNav />}

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

      {isStudent && showAiTutorFab && (
        <div className="hidden md:block fixed bottom-10 right-10 z-[100] group">
          <div className="absolute bottom-full right-0 mb-4 w-48 bg-white/95 backdrop-blur-sm text-gray-800 text-xs rounded-xl shadow-2xl p-3.5 border border-emerald-100 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none">
            <div className="font-bold text-emerald-600 mb-1 flex items-center gap-1">
              <Sparkles size={14} /> 터디 대기 중!
            </div>
            어려운 문제가 있나요? 언제든지 편하게 물어보세요.
            <div className="absolute -bottom-2 right-4 w-4 h-4 bg-white border-b border-r border-emerald-100 transform rotate-45" />
          </div>
          <Link
            href="/chatbot"
            className="flex items-center justify-center w-24 h-24 bg-transparent rounded-full hover:scale-110 transition-all duration-300 overflow-visible"
          >
            <Image
              alt="터디"
              className="h-full w-full object-contain scale-125 fab-bot-icon"
              height={96}
              src="https://i.ibb.co/whB3QBtt/AIDrawing-260714-621f8e04-8036-47f2-b44a-a11ac360ee20-0-Miri-Canvas.png"
              width={96}
            />
          </Link>
        </div>
      )}
    </>
  );
}
