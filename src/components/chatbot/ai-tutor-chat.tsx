"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence, type PanInfo } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Send, Bot, User, AlertCircle, Sparkles, Hand, Menu, ArrowLeft, Plus, Trash2 } from "lucide-react";
import { askAiTutor } from "@/services/ai-tutor.actions";
import { escalateTutorQuestion } from "@/services/ask.actions";
import { useAppStore } from "@/store/app-store";
import type { ProfessorQuestionCourseOption } from "@/types/professor-questions";
// TODO: Supabase integration for loading/saving messages from db

type Message = {
  id: string;
  role: "user" | "ai";
  content: string;
  isEscalated?: boolean;
  category?: string;
  originalQuestion?: string;
  sourceMessageId?: string | null;
};

export function AiTutorChat({ courses }: { courses: ProfessorQuestionCourseOption[] }) {
  const router = useRouter();
  const { 
    isChatSidebarOpen, 
    setIsChatSidebarOpen,
    cachedSessions,
  } = useAppStore();

  const [messages, setMessages] = useState<Message[]>([{
    id: "welcome",
    role: "ai",
    content: "안녕하세요! PaceMate AI 학습 튜터입니다. 궁금한 점을 편하게 물어보세요.",
  }]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [selectedCourseId, setSelectedCourseId] = useState(courses[0]?.id ?? "");
  const [escalationMessage, setEscalationMessage] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  // 스와이프로 뒤로가기 (Framer Motion drag)
  const handleDragEnd = (
    _event: MouseEvent | TouchEvent | PointerEvent,
    info: PanInfo,
  ) => {
    if (info.offset.x > 100 && info.velocity.x > 200) {
      router.back();
    }
  };

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
      const result = await askAiTutor(userMessage);
      
      setMessages([
        ...newMessages,
        {
          id: Date.now().toString(),
          role: "ai",
          content: result.response,
          category: result.category,
          isEscalated: result.isEscalated,
          originalQuestion: userMessage,
          sourceMessageId: result.sourceMessageId,
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

  const handleAskProfessor = async (message: Message) => {
    if (!message.sourceMessageId || !message.category || !selectedCourseId || isLoading) return;
    setIsLoading(true);
    const formData = new FormData();
    formData.set("courseId", selectedCourseId);
    formData.set("category", message.category);
    formData.set("sourceMessageId", message.sourceMessageId);
    const result = await escalateTutorQuestion(formData);
    setEscalationMessage(result.message);
    setIsLoading(false);
  };

  return (
    <motion.div 
      className="flex h-full w-full bg-white relative"
      drag="x"
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={{ right: 0.5, left: 0 }}
      onDragEnd={handleDragEnd}
    >
      {/* Sidebar Overlay */}
      <AnimatePresence>
        {isChatSidebarOpen && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.5 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsChatSidebarOpen(false)}
              className="absolute inset-0 bg-black z-40 md:hidden"
            />
            <motion.div
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", bounce: 0, duration: 0.3 }}
              className="absolute md:relative z-50 w-[280px] h-full bg-gray-50 border-r border-gray-200 flex flex-col"
            >
              <div className="p-4 flex items-center justify-between border-b border-gray-200 bg-white">
                <span className="font-semibold text-gray-800">채팅 기록</span>
                <Button variant="ghost" size="icon" onClick={() => setIsChatSidebarOpen(false)} className="md:hidden">
                  <ArrowLeft size={18} />
                </Button>
              </div>
              <div className="p-3">
                <Button 
                  variant="outline" 
                  className="w-full justify-start gap-2 border-dashed border-emerald-200 text-emerald-700 hover:bg-emerald-50 hover:border-emerald-300"
                  onClick={() => {
                    setMessages([{ id: "welcome", role: "ai", content: "안녕하세요! PaceMate AI 학습 튜터입니다. 궁금한 점을 편하게 물어보세요." }]);
                    setIsChatSidebarOpen(false);
                  }}
                >
                  <Plus size={16} />
                  새 대화 시작
                </Button>
              </div>
              <div className="flex-1 overflow-y-auto px-3 pb-4 space-y-2">
                {cachedSessions.map(session => (
                  <div key={session.id} className="p-3 rounded-lg hover:bg-white border border-transparent hover:border-gray-200 cursor-pointer group flex justify-between items-center transition-colors">
                    <div className="truncate text-sm text-gray-700">
                      {session.title}
                    </div>
                    <button className="text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col h-full bg-white relative w-full">
        {/* Header */}
        <div className="h-[60px] flex items-center px-4 border-b border-gray-100 bg-white/95 backdrop-blur-sm z-10 shrink-0 gap-3 sticky top-0">
          <Button variant="ghost" size="icon" onClick={() => router.back()} className="mr-1 -ml-2 text-gray-500">
            <ArrowLeft size={20} />
          </Button>
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center text-white shadow-sm">
            <Sparkles size={16} strokeWidth={2.5} />
          </div>
          <div className="flex-1">
            <h2 className="text-sm font-bold text-gray-800 leading-tight">PaceMate AI Tutor</h2>
            <p className="text-[11px] text-gray-500">프리미엄 학습 어시스턴트</p>
          </div>
          <Button variant="ghost" size="icon" onClick={() => setIsChatSidebarOpen(!isChatSidebarOpen)} className="text-gray-500">
            <Menu size={20} />
          </Button>
        </div>

        {/* Chat Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-6 bg-slate-50/50">
          {messages.map((m) => (
            <div key={m.id} className={`flex gap-3 max-w-3xl mx-auto w-full ${m.role === "user" ? "flex-row-reverse" : ""}`}>
              {/* Avatar */}
              <div className={`w-8 h-8 shrink-0 rounded-full flex items-center justify-center shadow-sm ${m.role === "user" ? "bg-gray-100 text-gray-600" : "bg-emerald-100 text-emerald-600"}`}>
                {m.role === "user" ? <User size={16} strokeWidth={2.5} /> : <Bot size={18} strokeWidth={2.5} />}
              </div>
              
              {/* Message Content */}
              <div className={`flex flex-col gap-2 max-w-[80%] ${m.role === "user" ? "items-end" : "items-start"}`}>
                <div className={`px-4 py-2.5 rounded-2xl text-[15px] leading-relaxed shadow-sm ${
                  m.role === "user" 
                    ? "bg-emerald-600 text-white rounded-tr-sm" 
                    : "bg-white text-gray-800 border border-gray-100 rounded-tl-sm"
                }`}>
                  <p className="whitespace-pre-wrap break-words">{m.content}</p>
                </div>
                
                {/* Meta badges */}
                {(m.category || m.isEscalated) && (
                  <div className="flex flex-col gap-1.5 mt-1 items-start">
                    <div className="flex items-center gap-1.5">
                      {m.category && (
                        <span className="text-[11px] font-medium bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded-md border border-emerald-100">
                          {m.category}
                        </span>
                      )}
                      {m.isEscalated && (
                        <div className="flex items-center gap-1 text-[11px] font-semibold text-rose-500 bg-rose-50 px-2 py-0.5 rounded-md border border-rose-100">
                          <AlertCircle size={12} strokeWidth={3} />
                          <span>신뢰도 낮음</span>
                        </div>
                      )}
                    </div>
                    {m.isEscalated && m.originalQuestion ? (
                      <div className="mt-1 flex flex-col gap-2 rounded-lg border border-rose-200 bg-white p-2">
                        <select
                          aria-label="질문을 전달할 과목"
                          value={selectedCourseId}
                          onChange={(event) => setSelectedCourseId(event.target.value)}
                          className="rounded-md border px-2 py-1.5 text-xs text-gray-700"
                        >
                          {courses.map((course) => (
                            <option key={course.id} value={course.id}>{course.name}</option>
                          ))}
                        </select>
                        <button
                          className="flex items-center gap-1.5 text-xs text-rose-600"
                          disabled={!m.sourceMessageId || !selectedCourseId || isLoading}
                          onClick={() => handleAskProfessor(m)}
                          type="button"
                        >
                          <Hand size={14} />
                          교수에게 이 질문 전달하기
                        </button>
                        {!m.sourceMessageId ? (
                          <span className="text-xs text-gray-500">
                            대화 원문을 안전하게 저장하지 못해 전달할 수 없습니다.
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            </div>
          ))}
          {isLoading && (
            <div className="flex gap-3 max-w-3xl mx-auto w-full">
              <div className="w-8 h-8 shrink-0 rounded-full flex items-center justify-center shadow-sm bg-emerald-100 text-emerald-600">
                <Bot size={18} strokeWidth={2.5} />
              </div>
              <div className="px-4 py-3 rounded-2xl bg-white border border-gray-100 rounded-tl-sm flex items-center gap-1.5">
                <motion.div animate={{ scale: [1, 1.2, 1], opacity: [0.4, 1, 0.4] }} transition={{ repeat: Infinity, duration: 1, delay: 0 }} className="w-1.5 h-1.5 bg-emerald-400 rounded-full" />
                <motion.div animate={{ scale: [1, 1.2, 1], opacity: [0.4, 1, 0.4] }} transition={{ repeat: Infinity, duration: 1, delay: 0.2 }} className="w-1.5 h-1.5 bg-emerald-400 rounded-full" />
                <motion.div animate={{ scale: [1, 1.2, 1], opacity: [0.4, 1, 0.4] }} transition={{ repeat: Infinity, duration: 1, delay: 0.4 }} className="w-1.5 h-1.5 bg-emerald-400 rounded-full" />
              </div>
            </div>
          )}
          {escalationMessage ? (
            <p className="mx-auto max-w-3xl text-sm text-gray-600" aria-live="polite">
              {escalationMessage}
            </p>
          ) : null}
          <div ref={chatEndRef} />
        </div>

        {/* Input Area */}
        <div className="p-3 bg-white border-t border-gray-100 shrink-0 pb-safe">
          <form onSubmit={handleSubmit} className="relative max-w-3xl mx-auto flex items-end gap-2">
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
                  e.currentTarget.style.height = '48px';
                }
              }}
              placeholder="학습에 관해 무엇이든 물어보세요..."
              className="flex-1 min-h-[48px] max-h-[120px] bg-gray-100 border-transparent rounded-2xl px-4 py-3 text-[15px] focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:bg-white transition-all resize-none overflow-y-auto placeholder:text-gray-400"
              disabled={isLoading}
              rows={1}
              style={{ height: '48px' }}
            />
            <button 
              type="submit" 
              className={`w-12 h-12 shrink-0 rounded-full flex items-center justify-center transition-all ${
                input.trim() && !isLoading 
                  ? 'bg-emerald-600 text-white shadow-md hover:bg-emerald-700 hover:scale-105 active:scale-95' 
                  : 'bg-gray-100 text-gray-400 cursor-not-allowed'
              }`} 
              disabled={isLoading || !input.trim()}
            >
              <Send size={20} className={input.trim() && !isLoading ? "translate-x-[1px] -translate-y-[1px]" : ""} />
            </button>
          </form>
          <p className="text-center text-[10px] text-gray-400 mt-2 max-w-3xl mx-auto pb-1">
            AI 튜터는 실수를 할 수 있습니다. 중요한 평가 사항은 꼭 조교나 교수님께 확인하세요.
          </p>
        </div>
      </div>
    </motion.div>
  );
}
