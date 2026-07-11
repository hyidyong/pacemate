import {
  Bot,
  CalendarDays,
  ClipboardList,
  GraduationCap,
  LayoutDashboard,
  LibraryBig,
  LogIn,
  MessageSquareText,
  PenLine,
  Route,
  ShieldCheck,
  Star,
  UserRound,
  UsersRound,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type AppRoute = {
  href: string;
  label: string;
  description: string;
  group: "core" | "student" | "community" | "ops";
  icon: LucideIcon;
  nextStep: string;
};

export const appRoutes: AppRoute[] = [
  {
    href: "/login",
    label: "로그인",
    description: "데모 식별자와 역할을 선택하는 진입 화면",
    group: "core",
    icon: LogIn,
    nextStep: "Supabase Auth 기반 데모 로그인 연결",
  },
  {
    href: "/onboarding",
    label: "온보딩",
    description: "학생 유형과 로드맵 입력값을 받는 화면",
    group: "student",
    icon: ClipboardList,
    nextStep: "학생 프로필 저장 폼 구현",
  },
  {
    href: "/dashboard",
    label: "대시보드",
    description: "개인화 홈, 최근 질문, 스크랩, 상담 현황",
    group: "core",
    icon: LayoutDashboard,
    nextStep: "역할별 대시보드 데이터 분기",
  },
  {
    href: "/mypage",
    label: "마이페이지",
    description: "개인 시간표, 즐겨찾기 과목, 과목 커뮤니티 진입",
    group: "core",
    icon: UserRound,
    nextStep: "시간표와 즐겨찾기 과목을 Supabase student_courses에 저장",
  },
  {
    href: "/roadmap",
    label: "로드맵",
    description: "전공기초, 우선 과목, 학기별 추천 순서",
    group: "student",
    icon: Route,
    nextStep: "AI 추천 요청/결과 UI 분리",
  },
  {
    href: "/courses",
    label: "과목",
    description: "과목 정보, 교수, 강의계획서, 관련 후기",
    group: "student",
    icon: LibraryBig,
    nextStep: "과목 목록/상세와 관리자 입력 연결",
  },
  {
    href: "/community",
    label: "커뮤니티",
    description: "카테고리별 질문, 글쓰기, 댓글, 반응",
    group: "community",
    icon: MessageSquareText,
    nextStep: "게시글 CRUD와 유사 질문 추천 연결",
  },
  {
    href: "/reviews",
    label: "수강 후기",
    description: "난이도, 과제량, 팀플, 평가 방식 후기",
    group: "community",
    icon: Star,
    nextStep: "과목별 후기 작성/조회 구현",
  },
  {
    href: "/chatbot",
    label: "AI 튜터",
    description: "공식 자료와 커뮤니티 참고 정보를 구분하는 질의응답",
    group: "student",
    icon: Bot,
    nextStep: "OpenAI 분류와 출처 표시 응답 연결",
  },
  {
    href: "/counseling",
    label: "상담 예약",
    description: "교수별 가능 시간 확인, 신청, 상태 관리",
    group: "student",
    icon: CalendarDays,
    nextStep: "예약 충돌 방지와 승인 흐름 구현",
  },
  {
    href: "/professor",
    label: "교수",
    description: "상담 승인, 에스컬레이션 답변, FAQ 관리",
    group: "ops",
    icon: GraduationCap,
    nextStep: "교수 권한 화면과 처리 큐 연결",
  },
  {
    href: "/admin",
    label: "관리자",
    description: "사용자, 게시글, 신고, 공지, FAQ, 과목 관리",
    group: "ops",
    icon: ShieldCheck,
    nextStep: "운영 테이블과 역할 기반 접근 제어",
  },
];

export const routeGroups = [
  { id: "core", label: "기본" },
  { id: "student", label: "학생 기능" },
  { id: "community", label: "커뮤니티" },
  { id: "ops", label: "운영" },
] as const;

export const roleCards = [
  {
    title: "학생",
    icon: UsersRound,
    items: ["프로필 작성", "로드맵 추천", "커뮤니티/후기", "상담 신청"],
  },
  {
    title: "교수",
    icon: GraduationCap,
    items: ["상담 시간 입력", "승인/거절", "에스컬레이션 답변", "FAQ 후보 관리"],
  },
  {
    title: "조교/관리자",
    icon: PenLine,
    items: ["공지/FAQ", "과목 관리", "신고 처리", "사용자 관리"],
  },
];
