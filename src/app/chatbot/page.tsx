import { AiTutorChat } from "@/components/chatbot/ai-tutor-chat";
import { redirectNonStudent } from "@/services/role-guard.service";
import { getDemoProfile } from "@/services/session.service";
import { getStudentProfessorQuestionData } from "@/services/professor-questions.server";

export const dynamic = "force-dynamic";
export default async function ChatbotPage() {
  const profile = await getDemoProfile();
  redirectNonStudent(profile);
  const questionData = await getStudentProfessorQuestionData();

  return (
    <div className="h-[100dvh] w-full bg-white flex flex-col overflow-hidden">
      <AiTutorChat courses={questionData.courses} />
    </div>
  );
}
