import Link from "next/link";
import { ArrowLeft, MessageSquareText } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { getCounselingPageData } from "@/services/counseling.service";
import { redirectNonStudent } from "@/services/role-guard.service";
import { getDemoProfile } from "@/services/session.service";
import { AskProfessorForm } from "@/components/ask/ask-professor-form";

export const dynamic = "force-dynamic";

export default async function AskPage({
  searchParams,
}: {
  searchParams?: Promise<{ defaultQuestion?: string }>;
}) {
  const profile = await getDemoProfile();
  redirectNonStudent(profile);
  const data = await getCounselingPageData(profile);
  const params = await searchParams;
  const defaultQuestion = params?.defaultQuestion || "";

  return (
    <AppShell>
      <section className="screen-hero">
        <Link href="/chatbot" className="status-line">
          <ArrowLeft size={15} aria-hidden="true" />
          AI 튜터로 돌아가기
        </Link>
        <h1>교수님/조교님께 질문하기</h1>
        <p>
          AI 튜터가 해결하지 못한 질문이나 더 깊이 있는 학업 상담, 행정 문의를 남겨주세요.
        </p>
      </section>
      <section className="section max-w-3xl mx-auto w-full">
        <div className="bg-card border rounded-xl p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-6 text-primary font-medium">
            <MessageSquareText size={20} />
            <h2>질문 작성</h2>
          </div>
          <AskProfessorForm 
            courses={data.courses} 
            defaultQuestion={defaultQuestion} 
          />
        </div>
      </section>
    </AppShell>
  );
}
