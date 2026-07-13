import Link from "next/link";
import { ArrowLeft, MessageSquareText } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { getStudentProfessorQuestionData } from "@/services/professor-questions.server";
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
  const data = await getStudentProfessorQuestionData();
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
      <section className="section max-w-3xl mx-auto w-full" aria-labelledby="my-professor-questions">
        <div className="bg-card border rounded-xl p-6 shadow-sm">
          <h2 id="my-professor-questions" className="mb-4 text-lg font-semibold">내 질문과 답변</h2>
          {data.questions.length ? (
            <div className="space-y-3">
              {data.questions.map((question) => (
                <article key={question.id} className="rounded-lg border p-4">
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>{question.courseName}</span>
                    <span>{question.category}</span>
                    <span>{question.sourceKind === "tutor" ? "AI 튜터 전달" : "직접 질문"}</span>
                  </div>
                  <p className="text-sm">{question.question}</p>
                  {question.answer ? (
                    <div className="mt-3 rounded-md bg-emerald-50 p-3 text-sm text-emerald-950">
                      <strong>{question.answerMode === "automatic" ? "자동 답변" : "교수 답변"}</strong>
                      <p className="mt-1 whitespace-pre-wrap">{question.answer}</p>
                    </div>
                  ) : (
                    <p className="mt-3 text-sm text-muted-foreground">답변 대기 중입니다.</p>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">아직 등록한 질문이 없습니다.</p>
          )}
        </div>
      </section>
    </AppShell>
  );
}
