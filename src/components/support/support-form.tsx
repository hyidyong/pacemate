"use client";

import { useState, useTransition, useEffect, useRef } from "react";
import { Send, Bot, User } from "lucide-react";
import { submitSupportInquiry } from "@/services/support.actions";

type ChatMessage = {
  id: string;
  sender: "user" | "system";
  text: string;
  time: string;
};

export function SupportForm() {
  const [message, setMessage] = useState("");
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([
    {
      id: "init",
      sender: "system",
      text: "안녕하세요! PaceMate AI 어시스턴트입니다. 계정/권한, 상담 예약, 로드맵, 기타 오류 등에 대해 편하게 물어보세요. 즉시 해결할 수 있는 부분은 자동 답변해 드립니다.",
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    }
  ]);
  const [isPending, startTransition] = useTransition();
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory]);

  function submitInquiry() {
    if (!message.trim()) return;

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      sender: "user",
      text: message,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setChatHistory((prev) => [...prev, userMessage]);
    const currentMsg = message;
    setMessage("");

    const formData = new FormData();
    formData.set("category", "system"); // Default category for chat
    formData.set("title", "챗봇 문의");
    formData.set("message", currentMsg);

    startTransition(async () => {
      const result = await submitSupportInquiry(formData);
      
      // Simulate slight delay for AI typing feel
      setTimeout(() => {
        setChatHistory((prev) => [
          ...prev,
          {
            id: `sys-${Date.now()}`,
            sender: "system",
            text: result.message || "문의가 성공적으로 접수되었습니다. 추가 도움이 필요하시면 언제든 말씀해 주세요.",
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          },
        ]);
      }, 600);
    });
  }

  return (
    <div className="chat-container">
      <div className="chat-history">
        {chatHistory.map((msg) => (
          <div key={msg.id} className={`chat-bubble-wrapper ${msg.sender}`}>
            <div className={`chat-bubble ${msg.sender}`}>
              {msg.text}
            </div>
            <span className="chat-time">
              {msg.sender === "system" ? <Bot size={12} style={{ display: "inline", marginRight: "4px" }} /> : null}
              {msg.time}
            </span>
          </div>
        ))}
        {isPending && (
          <div className="chat-bubble-wrapper system">
            <div className="chat-bubble system" style={{ fontStyle: "italic", opacity: 0.7 }}>
              타이핑 중...
            </div>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>
      <div className="chat-input-area">
        <input
          className="chat-input"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submitInquiry();
            }
          }}
          placeholder="메시지를 입력하세요..."
          disabled={isPending}
        />
        <button
          className="chat-send-btn"
          disabled={isPending || !message.trim()}
          onClick={submitInquiry}
          type="button"
          aria-label="전송"
        >
          <Send size={18} />
        </button>
      </div>
    </div>
  );
}
