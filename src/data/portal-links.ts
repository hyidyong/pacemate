import {
  BookOpenCheck,
  Building2,
  Library,
  MonitorCog,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

export type PortalLinkId =
  | "school-homepage"
  | "teaching-learning-center"
  | "dongsan-library"
  | "story-plus"
  | "edward-system";

export type PortalLink = {
  id: PortalLinkId;
  name: string;
  mobileName?: string;
  description: string;
  href: string;
  Icon: LucideIcon;
};

export const portalLinks = [
  {
    id: "school-homepage",
    name: "학교 홈페이지",
    description: "학교 대표 홈페이지와 주요 공지를 확인합니다.",
    href: "https://www.gokmu.ac.kr/main.htm",
    Icon: Building2,
  },
  {
    id: "teaching-learning-center",
    name: "교수학습지원센터",
    mobileName: "교수학습 지원센터",
    description: "교수학습 프로그램과 학습 지원 자료를 확인합니다.",
    href: "https://ctl.kmu.ac.kr/index.jsp",
    Icon: BookOpenCheck,
  },
  {
    id: "dongsan-library",
    name: "동산도서관",
    description: "도서 검색, 전자자료, 열람실 정보를 확인합니다.",
    href: "https://library.kmu.ac.kr/",
    Icon: Library,
  },
  {
    id: "story-plus",
    name: "Story+",
    description: "비교과 프로그램, 상담, 포트폴리오를 확인합니다.",
    href: "https://story.kmu.ac.kr/main.do",
    Icon: Sparkles,
  },
  {
    id: "edward-system",
    name: "에드워드 시스템",
    mobileName: "에드워드",
    description: "학사정보, 수강, 성적, 학적 서비스를 확인합니다.",
    href: "https://edward.kmu.ac.kr/",
    Icon: MonitorCog,
  },
] as const satisfies readonly PortalLink[];

export const studentPortalLinks = portalLinks;

export const professorPortalLinks = portalLinks.filter(
  (link) => link.id !== "story-plus",
);
