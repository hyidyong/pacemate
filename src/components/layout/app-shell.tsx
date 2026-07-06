import Link from "next/link";
import { CircleHelp, GraduationCap, MessageSquareText, ShieldCheck, UserRound, Bot, Sparkles } from "lucide-react";
import { AppHeader } from "@/components/layout/app-header";
import { NotificationMenu } from "@/components/notifications/notification-menu";
import { appRoutes } from "@/lib/navigation";
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
  const homeHref = profile ? getRoleHomePath(profile.role) : "/";
  const desktopRoutes = !isAuthenticated
    ? []
    : isProfessor
      ? appRoutes.filter((route) => route.href === "/professor")
      : isOperator
        ? appRoutes.filter((route) => route.href === "/admin")
        : appRoutes
            .filter((route) => !["/community", "/mypage", "/professor", "/admin"].includes(route.href))
            .slice(0, 6);
  const mobileRouteHrefs = !isAuthenticated
    ? []
    : isProfessor
      ? ["/professor"]
      : isOperator
        ? ["/admin"]
        : ["/dashboard", "/mypage", "/chatbot", "/counseling", "/community"];
  const mobileRoutes = appRoutes.filter((route) => mobileRouteHrefs.includes(route.href));
  
  // Custom labels for the 5-tab design
  const mobileTabLabels: Record<string, string> = {
    "/dashboard": "홈",
    "/mypage": "일정",
    "/chatbot": "질문",
    "/counseling": "상담",
    "/community": "커뮤니티"
  };

  return (
    <div className="app-shell">
      <AppHeader
        isAuthenticated={isAuthenticated}
        isProfessor={isProfessor}
        isOperator={isOperator}
        homeHref={homeHref}
        desktopRoutes={desktopRoutes}
        mobileRoutes={mobileRoutes}
        notifications={notifications}
        unreadCount={unreadCount}
      />

      <main className="pb-[70px] md:pb-0">{children}</main>

      {isAuthenticated && !isProfessor && !isOperator && (
        <nav 
          className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-white/90 backdrop-blur-md border-t border-gray-100 grid grid-cols-5 items-center justify-items-center h-[60px]"
          aria-label="Mobile primary navigation"
        >
          {mobileRoutes.map((route) => {
            const Icon = route.icon;
            // Determine if active by simple pathname matching would need client side hook, but for now we rely on standard inactive text-gray-400
            // Since this is a server component, we will just apply text-gray-400 and let it be generic, or we can use a client component if strict active state is needed.
            // For now, we will add generic classes.
            return (
              <Link 
                href={route.href} 
                key={route.href}
                className="flex flex-col items-center gap-1 text-gray-400 hover:text-emerald-600 active:text-emerald-600 transition-colors"
              >
                <Icon size={20} strokeWidth={1.5} aria-hidden="true" />
                <span className="text-[11px] font-medium">{mobileTabLabels[route.href] || route.label}</span>
              </Link>
            );
          })}
        </nav>
      )}
      
      {/* Mobile nav for other roles */}
      {isAuthenticated && (isProfessor || isOperator) && (
        <nav 
          className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-white/90 backdrop-blur-md border-t border-gray-100 flex items-center justify-around h-[60px]"
          aria-label="Mobile primary navigation"
        >
          {mobileRoutes.map((route) => {
            const Icon = route.icon;
            return (
              <Link 
                href={route.href} 
                key={route.href}
                className="flex flex-col items-center gap-1 text-gray-400 hover:text-emerald-600 transition-colors"
              >
                <Icon size={20} strokeWidth={1.5} aria-hidden="true" />
                <span className="text-[11px] font-medium">{route.label}</span>
              </Link>
            );
          })}
        </nav>
      )}

      {/* Global AI Tutor FAB for Students */}
      {isAuthenticated && !isProfessor && !isOperator && (
        <div className="fixed bottom-[80px] right-4 md:bottom-10 md:right-10 z-[100] group">
          {/* Tooltip */}
          <div className="absolute bottom-full right-0 mb-4 w-48 bg-white/95 backdrop-blur-sm text-gray-800 text-xs rounded-xl shadow-2xl p-3.5 border border-emerald-100 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none origin-bottom-right">
            <div className="font-bold text-emerald-600 mb-1 flex items-center gap-1">
              <Sparkles size={14} /> AI 튜터 대기 중!
            </div>
            어려운 문제가 있나요? 언제든 편하게 물어보세요!
            <div className="absolute -bottom-2 right-4 w-4 h-4 bg-white border-b border-r border-emerald-100 transform rotate-45"></div>
          </div>
          {/* FAB */}
          <Link href="/chatbot" className="flex items-center justify-center w-14 h-14 bg-gradient-to-tr from-emerald-600 to-teal-500 text-white rounded-full shadow-[0_8px_30px_rgba(16,185,129,0.4)] hover:shadow-[0_12px_40px_rgba(16,185,129,0.6)] hover:scale-110 transition-all duration-300 animate-[bounce_3s_infinite]">
            <Bot size={28} strokeWidth={2.5} className="animate-[wiggle_2s_ease-in-out_infinite]" />
          </Link>
          <style dangerouslySetInnerHTML={{__html: `
            @keyframes wiggle {
              0%, 100% { transform: rotate(-10deg); }
              50% { transform: rotate(10deg); }
            }
          `}} />
        </div>
      )}
    </div>
  );
}
