"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  CircleHelp,
  GraduationCap,
  MessageSquareText,
  ShieldCheck,
  UserRound,
  Bot,
  Menu,
  X,
  ChevronDown
} from "lucide-react";
import { NotificationMenu } from "@/components/notifications/notification-menu";
import { appRoutes } from "@/lib/navigation";
import type { UserNotification } from "@/services/notifications.service";

// ✅ Lazy load framer-motion — 헤더에서 초기 번들 ~160KB 절감
const MotionDiv = dynamic(
  () => import("framer-motion").then((m) => ({ default: m.motion.div })),
  { ssr: false }
);
const AnimatePresence = dynamic(
  () => import("framer-motion").then((m) => ({ default: m.AnimatePresence })),
  { ssr: false }
);

interface AppHeaderProps {
  isAuthenticated: boolean;
  isProfessor: boolean;
  isOperator: boolean;
  homeHref: string;
  notifications: UserNotification[];
  unreadCount: number;
}

export function AppHeader({
  isAuthenticated,
  isProfessor,
  isOperator,
  homeHref,
  notifications,
  unreadCount,
}: AppHeaderProps) {
  const [isMegaMenuOpen, setIsMegaMenuOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isProfessorMenuOpen, setIsProfessorMenuOpen] = useState(false);

  useEffect(() => {
    const handleProfessorMenuState = (event: Event) => {
      setIsProfessorMenuOpen(Boolean((event as CustomEvent<boolean>).detail));
    };

    window.addEventListener("professor-mobile-menu-state", handleProfessorMenuState);

    return () => {
      window.removeEventListener("professor-mobile-menu-state", handleProfessorMenuState);
    };
  }, []);

  const handleMobileMenuToggle = () => {
    if (isProfessor) {
      window.dispatchEvent(new Event("professor-mobile-menu-toggle"));
      return;
    }

    setIsMobileMenuOpen(previous => !previous);
  };

  const isMobileMenuVisible = isProfessor ? isProfessorMenuOpen : isMobileMenuOpen;

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

  return (
    <>
      {/* --- DESKTOP HEADER --- */}
      <header className="hidden md:flex items-center justify-between gap-5 py-4 pb-7 relative z-50">
        <Link href={homeHref} className="brand" aria-label="PaceMate home">
          <span>
            <strong>PaceMate</strong>
          </span>
        </Link>

        {/* Mega Menu Trigger */}
        <nav
          className="nav-links flex items-center h-full relative"
          onMouseEnter={() => setIsMegaMenuOpen(true)}
          onMouseLeave={() => setIsMegaMenuOpen(false)}
        >
          {desktopRoutes.map((route) => (
            <Link
              href={route.href}
              key={route.href}
              className="flex items-center gap-1 hover:text-emerald-700 transition-colors py-2"
            >
              {route.label}
              {route.href === "/dashboard" && <ChevronDown size={14} />}
            </Link>
          ))}

          {/* Mega Menu Dropdown */}
          <AnimatePresence>
            {isMegaMenuOpen && isAuthenticated && !isProfessor && !isOperator && (
              <MotionDiv
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-[600px] bg-white rounded-2xl shadow-2xl border border-emerald-100 p-6 grid grid-cols-3 gap-6 overflow-hidden z-[100]"
              >
                <div className="flex flex-col gap-3">
                  <h3 className="font-bold text-emerald-800 text-sm mb-1 border-b border-emerald-100 pb-2">학습 및 진도</h3>
                  <Link href="/dashboard" onClick={() => setIsMegaMenuOpen(false)} className="text-sm text-gray-600 hover:text-emerald-600 transition-colors">대시보드 홈</Link>
                  <Link href="/roadmap" onClick={() => setIsMegaMenuOpen(false)} className="text-sm text-gray-600 hover:text-emerald-600 transition-colors">나의 로드맵</Link>
                  <Link href="/courses" onClick={() => setIsMegaMenuOpen(false)} className="text-sm text-gray-600 hover:text-emerald-600 transition-colors">수강 과목 목록</Link>
                </div>
                <div className="flex flex-col gap-3">
                  <h3 className="font-bold text-emerald-800 text-sm mb-1 border-b border-emerald-100 pb-2">상담 및 지원</h3>
                  <Link href="/chatbot" onClick={() => setIsMegaMenuOpen(false)} className="text-sm text-gray-600 hover:text-emerald-600 transition-colors">AI 튜터에게 질문</Link>
                  <Link href="/counseling" onClick={() => setIsMegaMenuOpen(false)} className="text-sm text-gray-600 hover:text-emerald-600 transition-colors">교수님 상담 신청</Link>
                  <Link href="/support" onClick={() => setIsMegaMenuOpen(false)} className="text-sm text-gray-600 hover:text-emerald-600 transition-colors">운영팀 문의</Link>
                </div>
                <div className="flex flex-col gap-3 bg-emerald-50 -my-6 -mr-6 p-6">
                  <h3 className="font-bold text-emerald-800 text-sm mb-1">PaceMate 커뮤니티</h3>
                  <p className="text-xs text-emerald-600 mb-2 leading-relaxed">
                    다른 학생들과 함께 공부 팁을 나누고 질문해 보세요!
                  </p>
                  <Link 
                    href="/community" 
                    onClick={() => setIsMegaMenuOpen(false)}
                    className="mt-auto bg-emerald-600 text-white text-xs font-bold py-2 px-4 rounded-xl text-center hover:bg-emerald-700 transition-colors block w-full relative z-10"
                  >
                    커뮤니티 바로가기
                  </Link>
                </div>
              </MotionDiv>
            )}
          </AnimatePresence>
        </nav>

        <div className="header-actions" aria-label="Quick navigation">
          {isAuthenticated && isProfessor ? (
            <Link href="/professor/lounge" className="header-action-link header-action-community-link hidden md:inline-flex hover:scale-[1.01] hover:bg-opacity-90 transition-all duration-200">
              <MessageSquareText aria-hidden="true" />
              <span>교수 커뮤니티</span>
            </Link>
          ) : null}
          {isAuthenticated ? (
            <Link
              href="/support"
              className="header-action-link header-icon-link hover:scale-[1.01] hover:bg-opacity-90 transition-all duration-200"
              aria-label="문의하기"
            >
              <CircleHelp aria-hidden="true" />
              <span className="sr-only">문의하기</span>
            </Link>
          ) : null}
          {isAuthenticated ? (
            <NotificationMenu notifications={notifications} unreadCount={unreadCount} />
          ) : null}
          {isAuthenticated && !isProfessor && !isOperator ? (
            <>
              <Link href="/chatbot" className="header-action-link header-icon-link hover:scale-[1.01] hover:bg-opacity-90 transition-all duration-200" aria-label="AI 튜터">
                <Bot aria-hidden="true" />
                <span className="sr-only">AI 튜터</span>
              </Link>
              <Link href="/community" className="header-action-link header-action-community hover:scale-[1.01] hover:bg-opacity-90 transition-all duration-200">
                <MessageSquareText aria-hidden="true" />
                <span>커뮤니티</span>
              </Link>
              <Link
                href="/mypage"
                className="header-action-link header-icon-link header-action-primary hover:scale-[1.01] hover:bg-opacity-90 transition-all duration-200"
                aria-label="마이페이지로 이동"
              >
                <UserRound aria-hidden="true" />
                <span className="sr-only">마이페이지</span>
              </Link>
            </>
          ) : null}
          {isAuthenticated && isOperator ? (
            <Link href="/admin" className="header-action-link header-action-primary hover:scale-[1.01] hover:bg-opacity-90 transition-all duration-200">
              <ShieldCheck aria-hidden="true" />
              <span>운영 홈</span>
            </Link>
          ) : null}
        </div>
      </header>

      {/* --- MOBILE HEADER --- */}
      <header className="flex md:hidden items-center justify-between gap-5 py-4 pb-7 px-4 relative z-50">
        <Link href={homeHref} className="brand" aria-label="PaceMate home">
          <span>
            <strong>PaceMate</strong>
          </span>
        </Link>
        <div className="flex items-center gap-3">
          {isAuthenticated ? (
            <NotificationMenu notifications={notifications} unreadCount={unreadCount} />
          ) : null}
          
          <button
            aria-expanded={isMobileMenuVisible}
            aria-label={isMobileMenuVisible ? "메뉴 닫기" : "메뉴 열기"}
            onClick={handleMobileMenuToggle}
            type="button"
            className="relative z-50 inline-flex h-10 w-10 items-center justify-center bg-transparent text-slate-700 transition-colors hover:text-emerald-600 active:text-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
          >
            {isMobileMenuVisible ? <X size={24} aria-hidden="true" /> : <Menu size={24} aria-hidden="true" />}
          </button>
        </div>
      </header>

      {/* Mobile Hamburger Drawer Menu */}
      <AnimatePresence>
        {isMobileMenuOpen && !isProfessor && (
          <MotionDiv
            initial={{ opacity: 0, x: "100%" }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 200 }}
            className="fixed inset-0 z-40 bg-white md:hidden pt-24 px-6 pb-6 flex flex-col gap-6 overflow-y-auto"
          >
            <div className="flex flex-col gap-4">
              <h2 className="text-xl font-bold text-gray-900 border-b pb-2">메뉴</h2>
              {mobileRoutes.map((route) => {
                const Icon = route.icon;
                return (
                  <Link
                    href={route.href}
                    key={route.href}
                    onClick={() => setIsMobileMenuOpen(false)}
                    className="flex items-center gap-3 text-lg font-medium text-gray-700 hover:text-emerald-600 p-2 rounded-lg hover:bg-emerald-50 transition-colors"
                  >
                    {Icon && <Icon size={20} />}
                    {route.label}
                  </Link>
                );
              })}
            </div>

            <div className="mt-auto grid grid-cols-2 gap-3">
              <Link
                href="/support"
                onClick={() => setIsMobileMenuOpen(false)}
                className="flex items-center justify-center gap-2 py-3 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50"
              >
                <CircleHelp size={16} />
                고객센터
              </Link>
              <Link
                href="/mypage"
                onClick={() => setIsMobileMenuOpen(false)}
                className="flex items-center justify-center gap-2 py-3 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700"
              >
                <UserRound size={16} />
                마이페이지
              </Link>
            </div>
          </MotionDiv>
        )}
      </AnimatePresence>
    </>
  );
}
