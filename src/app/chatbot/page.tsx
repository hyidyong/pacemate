import { AppShell } from "@/components/layout/app-shell";
import { AiTutorChat } from "@/components/chatbot/ai-tutor-chat";
import { redirectNonStudent } from "@/services/role-guard.service";
import { getDemoProfile } from "@/services/session.service";

export default async function ChatbotPage() {
  const profile = await getDemoProfile();
  redirectNonStudent(profile);

  return (
    <AppShell>
      <section className="screen-hero">
        <h1>AI 튜터</h1>
        <p>
          질문을 분류하고 공식 자료 기반 답변과 참고 정보를 구분해 제공합니다.
          신뢰도가 낮거나 심화 상담이 필요한 질문은 교수님/조교님께 자동 전달됩니다.
        </p>
      </section>
      
      <section className="section max-w-4xl mx-auto w-full">
        <AiTutorChat studentId={profile!.id} />
      </section>
    </AppShell>
  );
}
