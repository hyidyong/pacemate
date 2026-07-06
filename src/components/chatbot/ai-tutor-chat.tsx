"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Send, Bot, User, AlertCircle, Sparkles, Hand } from "lucide-react";
import { askAiTutor } from "@/services/ai-tutor.actions";

type Message = {
  id: string;
  role: "user" | "ai";
  content: string;
  isEscalated?: boolean;
  category?: string;
  originalQuestion?: string;
};

export function AiTutorChat({ studentId }: { studentId: string }) {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([{
    id: "welcome",
    role: "ai",
    content: "안녕하세요! PaceMate AI 학습 튜터입니다. 궁금한 점을 편하게 물어보세요. (예: 이번 과제 제출 기한이 언제인가요?)",
  }]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    setInput("");
    
    const newMessages: Message[] = [
      ...messages, 
      { id: Date.now().toString(), role: "user", content: userMessage }
    ];
    setMessages(newMessages);
    setIsLoading(true);

    try {
      const result = await askAiTutor(userMessage, studentId);
      
      setMessages([
        ...newMessages,
        {
          id: Date.now().toString(),
          role: "ai",
          content: result.response,
          category: result.category,
          isEscalated: result.isEscalated,
          originalQuestion: userMessage,
        }
      ]);
    } catch (error) {
      setMessages([
        ...newMessages,
        {
          id: Date.now().toString(),
          role: "ai",
          content: "시스템 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
        }
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAskProfessor = (originalQuestion: string) => {
    const summary = `[AI 튜터 미해결 질문] ${originalQuestion.slice(0, 50)}${originalQuestion.length > 50 ? '...' : ''}`;
    router.push(`/ask?defaultQuestion=${encodeURIComponent(summary)}`);
  };

  return (
    <div className="ai-tutor-container">
      {/* Header */}
      <div className="ai-tutor-header">
        <div className="ai-tutor-header-icon">
          <Sparkles size={24} strokeWidth={2.5} />
        </div>
        <div className="ai-tutor-header-text">
          <h2>PaceMate AI Tutor</h2>
          <p>PaceMate 프리미엄 학습 어시스턴트</p>
        </div>
      </div>

      {/* Chat Area */}
      <div className="ai-tutor-chat-area">
        {messages.map((m) => (
          <div key={m.id} className={`ai-tutor-message-row ${m.role === "user" ? "is-user" : "is-ai"}`}>
            <div className="ai-tutor-message-content">
              {/* Avatar */}
              <div className={`ai-tutor-avatar ${m.role === "user" ? "is-user" : "is-ai"}`}>
                {m.role === "user" ? <User size={18} strokeWidth={2.5} /> : <Bot size={20} strokeWidth={2.5} />}
              </div>
              
              {/* Message Content */}
              <div className="ai-tutor-bubble-wrapper">
                <div className="ai-tutor-bubble">
                  <p>{m.content}</p>
                </div>
                
                {/* Meta badges */}
                {(m.category || m.isEscalated) && (
                  <div className="ai-tutor-meta">
                    <div className="ai-tutor-badges">
                      {m.category && (
                        <span className="ai-tutor-badge-category">
                          {m.category}
                        </span>
                      )}
                      {m.isEscalated && (
                        <div className="ai-tutor-badge-escalated">
                          <AlertCircle size={12} strokeWidth={3} />
                          <span>신뢰도 낮음 감지</span>
                        </div>
                      )}
                    </div>
                    {m.isEscalated && m.originalQuestion && (
                      <button 
                        className="ai-tutor-ask-button"
                        onClick={() => handleAskProfessor(m.originalQuestion!)}
                      >
                        <Hand size={14} />
                        교수님/조교에게 질문하기
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="ai-tutor-message-row is-ai">
            <div className="ai-tutor-message-content">
              <div className="ai-tutor-avatar is-ai">
                <Bot size={20} strokeWidth={2.5} />
              </div>
              <div className="ai-tutor-loading-dots">
                <div className="ai-tutor-loading-dot" />
                <div className="ai-tutor-loading-dot" />
                <div className="ai-tutor-loading-dot" />
              </div>
            </div>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      {/* Input Area (Floating Pill Style) */}
      <div className="ai-tutor-input-area">
        <form onSubmit={handleSubmit} className="ai-tutor-form">
          <textarea
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit(e as unknown as React.FormEvent);
                e.currentTarget.style.height = 'auto';
              }
            }}
            placeholder="학습에 관해 무엇이든 물어보세요..."
            className="ai-tutor-textarea"
            disabled={isLoading}
            rows={1}
            style={{ height: '48px' }}
          />
          <button 
            type="submit" 
            className={`ai-tutor-submit ${input.trim() && !isLoading ? 'is-active' : 'is-disabled'}`} 
            disabled={isLoading || !input.trim()}
          >
            <Send size={20} />
          </button>
        </form>
        <p className="ai-tutor-footer">
          AI 튜터는 실수를 할 수 있습니다. 중요한 평가 사항은 꼭 조교나 교수님께 확인하세요.
        </p>
      </div>
    </div>
  );
}
