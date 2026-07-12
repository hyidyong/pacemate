import PortalShortcutCard from "@/components/PortalShortcutCard";
import { professorPortalLinks } from "@/data/portal-links";

export function ProfessorPortalShortcutCard() {
  return (
    <PortalShortcutCard
      className="professor-portal-shortcut-card"
      description="교수 업무에 자주 쓰는 교내 서비스를 빠르게 엽니다."
      headingId="professor-portal-shortcut-title"
      links={professorPortalLinks}
      title="포털 바로가기"
    />
  );
}
