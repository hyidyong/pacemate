import { AiTutorChat } from "@/components/chatbot/ai-tutor-chat";
import { redirectNonStudent } from "@/services/role-guard.service";
import { getDemoProfile } from "@/services/session.service";

export const dynamic = "force-dynamic";
export default async function ChatbotPage() {
  const profile = await getDemoProfile();
  redirectNonStudent(profile);

  return (
    <div className="h-[100dvh] w-full bg-white flex flex-col overflow-hidden">
      <AiTutorChat studentId={profile!.id} />
    </div>
  );
}
