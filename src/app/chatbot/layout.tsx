import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "AI 튜터 | PaceMate",
  description: "PaceMate AI 학습 튜터 - 언제든 편하게 질문하세요",
};

// AppShell 없이 full-screen 독립 레이아웃
export default function ChatbotLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
