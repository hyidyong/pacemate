"use client";

import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays,
  CircleHelp,
  LayoutDashboard,
  LibraryBig,
  MessageSquareText,
  Route,
  ShieldCheck,
  Star,
  UserRound,
  Menu,
  X,
  ChevronDown,
} from "lucide-react";
import { NotificationMenu } from "@/components/notifications/notification-menu";
import { professorWeeklyPlanPreviewLink } from "@/lib/professor-navigation";
import type { UserNotification } from "@/types/notifications";

function MotionDiv({
  children,
  initial,
  animate,
  exit,
  transition,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  animate?: unknown;
  exit?: unknown;
  initial?: unknown;
  transition?: unknown;
}) {
  void initial;
  void animate;
  void exit;
  void transition;

  return <div {...props}>{children}</div>;
}

function AnimatePresence({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

const DESKTOP_HEADER_CLASS = "hidden md:flex items-center justify-between gap-5 py-4 pb-7 relative z-50";
const MOBILE_HEADER_CLASS =
  "sticky top-0 flex md:hidden items-center justify-between gap-5 py-3 px-4 z-50 bg-[#FAFDFC]/90 backdrop-blur-xl shadow-[0_12px_30px_rgba(17,24,22,0.07)]";

const professorDesktopMenuGroups = [
  {
    label: "일정 관리",
    items: [
      { label: "강의 일정", href: "/professor?tab=schedule&sub=calendar" },
      { label: "학사 일정", href: "/professor?tab=schedule&sub=calendar" },
      { label: "개인 메모", href: "/professor?tab=schedule&sub=manual-schedule" },
    ],
  },
  {
    label: "과목 관리",
    items: [
      { label: "강의 목록", href: "/professor?tab=roadmap&sub=roadmap-edit" },
      { label: "출석 관리", href: "/professor?tab=roadmap&sub=course-settings" },
      { label: "과제 및 평가", href: "/professor?tab=roadmap&sub=sensitive-request" },
      { label: "성적 입력", href: "/professor?tab=roadmap&sub=course-settings" },
      professorWeeklyPlanPreviewLink,
    ],
  },
  {
    label: "질문 관리",
    items: [
      { label: "미답변 질문", href: "/professor?tab=questions&sub=incoming-questions" },
      { label: "전체 질문 답변", href: "/professor?tab=questions&sub=incoming-questions" },
      { label: "FAQ 관리", href: "/professor?tab=questions&sub=manual-faq" },
    ],
  },
  {
    label: "상담 관리",
    items: [
      { label: "상담 신청 목록", href: "/professor?tab=counseling&sub=pending-counseling" },
      { label: "상담 일지 작성", href: "/professor?tab=counseling&sub=counseling-log" },
      { label: "예약 관리", href: "/professor?tab=counseling&sub=pending-counseling" },
    ],
  },
  {
    label: "학습 리포트",
    items: [
      { label: "학생 성취도 분석", href: "/professor?tab=report&sub=course-progress-report" },
      { label: "주차별 진도율", href: "/professor?tab=report&sub=course-progress-report" },
      { label: "학업 이탈 예측", href: "/professor?tab=report&sub=course-progress-report" },
    ],
  },
] as const;

type HeaderRoute = {
  href: string;
  label: string;
};

type MobileHeaderRoute = HeaderRoute & {
  icon?: ComponentType<{ size?: number }>;
};

const desktopRoutes: HeaderRoute[] = [
  { href: "/dashboard", label: "대시보드" },
  { href: "/roadmap", label: "로드맵" },
  { href: "/courses", label: "과목" },
  { href: "/counseling", label: "상담" },
  { href: "/reviews", label: "수강 후기" },
];

const mobileRoutes = desktopRoutes;
const mobileRouteIcons = {
  "/dashboard": LayoutDashboard,
  "/roadmap": Route,
  "/courses": LibraryBig,
  "/counseling": CalendarDays,
  "/reviews": Star,
} as const;

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
  const pathname = usePathname();
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
  const isStudentRoadmap = isAuthenticated && !isProfessor && !isOperator && pathname.startsWith("/roadmap");
  const roadmapMenuLinks: MobileHeaderRoute[] = [
    { href: "/roadmap", label: "내 로드맵", icon: Route },
    { href: "/roadmap#course-roadmap", label: "과목별 로드맵", icon: LibraryBig },
    { href: "/roadmap#learning-progress", label: "학습 기록", icon: CalendarDays },
    { href: "/notices", label: "공지사항", icon: MessageSquareText },
  ];
  const mobileMenuRoutes: MobileHeaderRoute[] = isStudentRoadmap
    ? roadmapMenuLinks
    : mobileRoutes.map((route) => ({
        ...route,
        icon: mobileRouteIcons[route.href as keyof typeof mobileRouteIcons],
      }));

  return (
    <>
      {/* --- DESKTOP HEADER --- */}
      <header className={DESKTOP_HEADER_CLASS}>
        <Link href={homeHref} className="brand" aria-label="Substudy home">
          <span>
            <img
              alt="substudy"
              className="h-[56px] w-auto object-contain"
              src="https://i.ibb.co/rKgLL4gX/AIDrawing-260714-730dfff9-7f89-42b7-97c8-5c46b35eafc1-0-Miri-Canvas.png"
            />
          </span>
        </Link>

        {isAuthenticated && isProfessor ? (
          <nav
            aria-label="교수 상단 메뉴"
            className="flex min-w-0 flex-1 items-center justify-start gap-1 overflow-x-auto px-1 lg:justify-center xl:gap-2"
            data-testid="professor-desktop-dropdown-nav"
          >
            {professorDesktopMenuGroups.map((group) => (
              <div className="group relative shrink-0" key={group.label}>
                <button
                  aria-haspopup="menu"
                  className="inline-flex whitespace-nowrap items-center gap-1.5 rounded-full px-2.5 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-emerald-50 hover:text-emerald-700 focus-visible:bg-emerald-50 focus-visible:text-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 xl:px-4"
                  type="button"
                >
                  <span>{group.label}</span>
                  <ChevronDown
                    aria-hidden="true"
                    className="h-3.5 w-3.5 transition-transform duration-200 group-hover:rotate-180 group-focus-within:rotate-180"
                  />
                </button>
                <div
                  className="pointer-events-none absolute left-1/2 top-full z-[120] mt-3 w-56 -translate-x-1/2 translate-y-2 rounded-2xl border border-slate-200 bg-white/95 p-2 opacity-0 shadow-[0_22px_55px_rgba(15,23,42,0.14)] backdrop-blur-xl transition-all duration-200 ease-out group-hover:pointer-events-auto group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:translate-y-0 group-focus-within:opacity-100"
                  role="menu"
                >
                  <div className="px-3 pb-2 pt-2 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">
                    {group.label}
                  </div>
                  <div className="flex flex-col gap-1">
                    {group.items.map((item) => (
                      <Link
                        className="rounded-xl px-3 py-2.5 text-sm font-medium text-slate-600 transition-colors hover:bg-emerald-50 hover:text-emerald-700 focus-visible:bg-emerald-50 focus-visible:text-emerald-700 focus-visible:outline-none"
                        href={item.href}
                        key={item.label}
                        role="menuitem"
                      >
                        {item.label}
                      </Link>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </nav>
        ) : null}

        {/* Student-only global navigation. Keep it out of the professor header DOM so
            shared nav CSS cannot make student links reappear in the professor GNB. */}
        {!isProfessor ? (
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
          {isAuthenticated && !isProfessor && !isOperator ? (
            <Link href="/notices" className="flex items-center gap-1 py-2 transition-colors hover:text-emerald-700">공지사항</Link>
          ) : null}

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
                </div>
                <div className="flex flex-col gap-3">
                  <h3 className="font-bold text-emerald-800 text-sm mb-1 border-b border-emerald-100 pb-2">상담 및 지원</h3>
                  <Link href="/chatbot" onClick={() => setIsMegaMenuOpen(false)} className="text-sm text-gray-600 hover:text-emerald-600 transition-colors">AI 튜터에게 질문</Link>
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
        ) : null}

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
      <header className={MOBILE_HEADER_CLASS}>
        <Link href={homeHref} className="brand" aria-label="Substudy home">
          <span>
            <img
              alt="substudy"
              className="h-[42px] w-auto object-contain"
              src="https://i.ibb.co/rKgLL4gX/AIDrawing-260714-730dfff9-7f89-42b7-97c8-5c46b35eafc1-0-Miri-Canvas.png"
            />
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
              {mobileMenuRoutes.map((route) => {
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
              {isAuthenticated && !isProfessor && !isOperator ? (
                <Link href="/notices" onClick={() => setIsMobileMenuOpen(false)} className="flex items-center gap-3 rounded-lg p-2 text-lg font-medium text-gray-700 transition-colors hover:bg-emerald-50 hover:text-emerald-600">공지사항</Link>
              ) : null}
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
