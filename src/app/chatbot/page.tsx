import { AiTutorChat } from "@/components/chatbot/ai-tutor-chat";
import { MobileBottomNav } from "@/components/layout/mobile-bottom-nav";
import { redirectNonStudent } from "@/services/role-guard.service";
import { getDemoProfile } from "@/services/session.service";
import { getStudentAiTutorCourses } from "@/services/professor-questions.server";

export const dynamic = "force-dynamic";
export default async function ChatbotPage() {
  const profile = await getDemoProfile();
  redirectNonStudent(profile);
  const courses = await getStudentAiTutorCourses().catch((error) => {
    console.error("AI tutor courses could not be loaded", error);
    return [];
  });

  // The AI 채팅 bottom-nav tab used to land on a screen WITHOUT the bottom
  // nav (this route skips AppShell) — the only exit was the back arrow
  // (Stage 4, audit C-5). The chat area shrinks by the nav height below md.
  return (
    <>
      <div className="h-[calc(100dvh-64px-env(safe-area-inset-bottom))] w-full bg-white flex flex-col overflow-hidden md:h-[100dvh]">
        <AiTutorChat courses={courses} />
      </div>
      <MobileBottomNav />
    </>
  );
}
