"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
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
  UserCircle2,
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
  { href: "/dashboard", label: "홈" },
  { href: "/roadmap", label: "로드맵" },
  { href: "/courses", label: "과목" },
  { href: "/counseling", label: "상담" },
  { href: "/reviews", label: "수강 후기" },
  { href: "/ask", label: "질문하기" },
];

const mobileRoutes = desktopRoutes;
const mobileRouteIcons = {
  "/dashboard": LayoutDashboard,
  "/roadmap": Route,
  "/courses": LibraryBig,
  "/counseling": CalendarDays,
  "/reviews": Star,
  "/ask": CircleHelp,
  "/community": MessageSquareText,
} as const;

interface AppHeaderProps {
  isAuthenticated: boolean;
  isProfessor: boolean;
  isOperator: boolean;
  homeHref: string;
  notifications: UserNotification[];
  unreadCount: number;
  profileId: string;
}

export function AppHeader({
  isAuthenticated,
  isProfessor,
  isOperator,
  homeHref,
  notifications,
  unreadCount,
  profileId,
}: AppHeaderProps) {
  const pathname = usePathname();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isProfessorMenuOpen, setIsProfessorMenuOpen] = useState(false);
  const [openProfessorDesktopMenu, setOpenProfessorDesktopMenu] = useState<string | null>(null);
  const professorDesktopNavRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const handleProfessorMenuState = (event: Event) => {
      setIsProfessorMenuOpen(Boolean((event as CustomEvent<boolean>).detail));
    };

    window.addEventListener("professor-mobile-menu-state", handleProfessorMenuState);

    return () => {
      window.removeEventListener("professor-mobile-menu-state", handleProfessorMenuState);
    };
  }, []);

  useEffect(() => {
    if (!openProfessorDesktopMenu) return;

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!professorDesktopNavRef.current?.contains(event.target as Node)) {
        setOpenProfessorDesktopMenu(null);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenProfessorDesktopMenu(null);
    };

    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [openProfessorDesktopMenu]);

  const handleMobileMenuToggle = () => {
    if (isProfessor) {
      window.dispatchEvent(new Event("professor-mobile-menu-toggle"));
      return;
    }

    setIsMobileMenuOpen(previous => !previous);
  };

  // Drawer dialog mechanics: Escape closes, background does not scroll.
  useEffect(() => {
    if (!isMobileMenuOpen) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsMobileMenuOpen(false);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = previousOverflow;
    };
  }, [isMobileMenuOpen]);

  const isMobileMenuVisible = isProfessor ? isProfessorMenuOpen : isMobileMenuOpen;
  const isStudentRoadmap = isAuthenticated && !isProfessor && !isOperator && pathname.startsWith("/roadmap");
  const roadmapMenuLinks: MobileHeaderRoute[] = [
    { href: "/roadmap#course-roadmap", label: "과목별 로드맵", icon: LibraryBig },
    { href: "/roadmap#learning-progress", label: "학습 기록", icon: CalendarDays },
  ];
  // Every site route stays reachable from the drawer on every page: the
  // roadmap shortcuts are PREPENDED, not swapped in for the whole menu, and
  // 커뮤니티 (previously desktop-only) is included (Stage 4, audit C-1/C-2).
  const baseMobileMenuRoutes: MobileHeaderRoute[] = [
    ...mobileRoutes.map((route) => ({
      ...route,
      icon: mobileRouteIcons[route.href as keyof typeof mobileRouteIcons],
    })),
    { href: "/community", label: "커뮤니티", icon: MessageSquareText },
  ];
  const mobileMenuRoutes: MobileHeaderRoute[] = isStudentRoadmap
    ? [...roadmapMenuLinks, ...baseMobileMenuRoutes]
    : baseMobileMenuRoutes;

  return (
    <>
      {/* --- DESKTOP HEADER --- */}
      <header className={DESKTOP_HEADER_CLASS}>
        <Link href={homeHref} className="brand" aria-label="Substudy home">
          <span>
            <Image
              alt="substudy"
              className="h-[56px] w-auto object-contain"
              height={56}
              src="/images/substudy-logo.png"
              width={168}
            />
          </span>
        </Link>

        {isAuthenticated && isProfessor ? (
          <nav
            aria-label="교수 상단 메뉴"
            className="flex min-w-0 flex-1 items-center justify-start gap-1 overflow-visible px-1 lg:justify-center xl:gap-2"
            data-testid="professor-desktop-dropdown-nav"
            ref={professorDesktopNavRef}
          >
            {professorDesktopMenuGroups.map((group) => (
              <div className="relative shrink-0" key={group.label}>
                <button
                  aria-expanded={openProfessorDesktopMenu === group.label}
                  aria-haspopup="menu"
                  className="inline-flex whitespace-nowrap items-center gap-1.5 rounded-full px-2.5 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-emerald-50 hover:text-emerald-700 focus-visible:bg-emerald-50 focus-visible:text-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 xl:px-4"
                  onClick={() => setOpenProfessorDesktopMenu((current) => current === group.label ? null : group.label)}
                  type="button"
                >
                  <span>{group.label}</span>
                  <ChevronDown
                    aria-hidden="true"
                    className={`h-3.5 w-3.5 transition-transform duration-200 ${openProfessorDesktopMenu === group.label ? "rotate-180" : ""}`}
                  />
                </button>
                {openProfessorDesktopMenu === group.label ? (
                  <div
                    className="absolute left-1/2 top-full z-[120] mt-3 w-56 -translate-x-1/2 rounded-2xl border border-slate-200 bg-white/95 p-2 shadow-[0_22px_55px_rgba(15,23,42,0.14)] backdrop-blur-xl"
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
                ) : null}
              </div>
            ))}
          </nav>
        ) : null}

        {/* Student-only global navigation. Keep it out of the professor header DOM so
            shared nav CSS cannot make student links reappear in the professor GNB. */}
        {!isProfessor ? (
        <nav className="nav-links flex items-center h-full relative">
          {desktopRoutes.map((route) => (
            <Link
              href={route.href}
              key={route.href}
              className="flex items-center gap-1 hover:text-emerald-700 transition-colors py-2"
            >
              {route.label}
            </Link>
          ))}
          {isAuthenticated && !isProfessor && !isOperator ? (
            <Link href="/notices" className="flex items-center gap-1 py-2 transition-colors hover:text-emerald-700">공지사항</Link>
          ) : null}
        </nav>
        ) : null}

        <div className="header-actions" aria-label="Quick navigation">
          {isAuthenticated && isProfessor ? (
            <Link href="/professor/lounge" className="header-action-link header-action-community-link hidden md:inline-flex hover:scale-[1.01] hover:bg-opacity-90 transition-all duration-200">
              <MessageSquareText aria-hidden="true" />
              <span>교수 커뮤니티</span>
            </Link>
          ) : null}
          {isAuthenticated && isProfessor ? (
            <Link
              href="/professor/mypage"
              className="header-action-link header-icon-link header-action-primary hover:scale-[1.01] hover:bg-opacity-90 transition-all duration-200"
              aria-label="교수 마이페이지로 이동"
            >
              <UserCircle2 aria-hidden="true" />
              <span className="sr-only">마이페이지</span>
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
            <NotificationMenu
              notifications={notifications}
              unreadCount={unreadCount}
              profileId={profileId}
              enableRealtime
            />
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
            <Image
              alt="substudy"
              className="h-[42px] w-auto object-contain"
              height={42}
              src="/images/substudy-logo.png"
              width={126}
            />
          </span>
        </Link>
        <div className="flex items-center gap-3">
          {isAuthenticated ? (
            <NotificationMenu notifications={notifications} unreadCount={unreadCount} profileId={profileId} />
          ) : null}

          <button
            aria-controls={isProfessor ? undefined : "mobile-menu-drawer"}
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
            className="fixed inset-0 z-40 bg-white md:hidden pt-24 px-6 pb-24 flex flex-col gap-6 overflow-y-auto"
            id="mobile-menu-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="메뉴"
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
