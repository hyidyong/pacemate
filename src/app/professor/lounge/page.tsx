import Link from "next/link";
import { ArrowLeft, MessageSquareText } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { ProfessorLounge } from "@/components/professor/professor-lounge";
import { Button } from "@/components/ui/button";
import { getProfessorLoungePosts } from "@/services/professor-community.service";
import { requireRoles } from "@/services/role-guard.service";
import { getDemoProfile } from "@/services/session.service";

export const dynamic = "force-dynamic";

export default async function ProfessorLoungePage() {
  const profile = await getDemoProfile();
  requireRoles(profile, ["professor"]);
  const posts = await getProfessorLoungePosts(profile);

  return (
    <AppShell>
      <section className="screen-hero professor-hero">
        <Link href="/professor" className="status-line">
          <ArrowLeft size={15} aria-hidden="true" />
          교수 대시보드
        </Link>
        <h1>교수 라운지</h1>
        <div className="actions">
          <Button asChild variant="outline">
            <Link href="/professor?tab=counseling">
              상담 업무 보기
              <MessageSquareText size={16} aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </section>

      <ProfessorLounge posts={posts} />
    </AppShell>
  );
}
