"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence, type PanInfo } from "framer-motion";
import { AlertCircle, ArrowLeft, Bot, Hand, Menu, Plus, Send, Trash2, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  askAiTutor,
  deleteAiTutorSession,
  getAiTutorSessionMessages,
  getAiTutorSessions,
  type AiTutorStoredMessage,
  type TutorCitation,
} from "@/services/ai-tutor-rag.actions";
import { submitQuestionToProfessor } from "@/services/ask.actions";
import { useAppStore } from "@/store/app-store";
import type { ProfessorQuestionCourseOption } from "@/types/professor-questions";

type Message = {
  id: string;
  role: "user" | "ai";
  content: string;
  isEscalated?: boolean;
  category?: string;
  originalQuestion?: string;
  sources?: TutorCitation[];
  canEscalate?: boolean;
};

const welcomeMessage: Message = {
  id: "welcome",
  role: "ai",
  content: "안녕하세요. AI 비서 터티입니다. 궁금한 점을 편하게 물어보세요!",
};

function toUiMessages(storedMessages: AiTutorStoredMessage[]): Message[] {
  if (!storedMessages.length) {
    return [welcomeMessage];
  }

  return storedMessages.map((message, index, all) => ({
    ...message,
    originalQuestion:
      message.role === "ai"
        ? [...all.slice(0, index)].reverse().find((candidate) => candidate.role === "user")?.content
        : undefined,
    canEscalate: message.role === "ai",
  }));
}

export function AiTutorChat({ courses }: { courses: ProfessorQuestionCourseOption[] }) {
  const router = useRouter();
  const {
    isChatSidebarOpen,
    setIsChatSidebarOpen,
    activeChatSessionId,
    setActiveChatSessionId,
    cachedSessions,
    setCachedSessions,
  } = useAppStore();

  const [messages, setMessages] = useState<Message[]>([welcomeMessage]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [selectedCourseId, setSelectedCourseId] = useState("");
  const [escalationMessage, setEscalationMessage] = useState("");
  const [editingEscalationId, setEditingEscalationId] = useState<string | null>(null);
  const [escalationDraft, setEscalationDraft] = useState("");
  const [isEscalationAnonymous, setIsEscalationAnonymous] = useState(false);
  const [isEscalationSubmitting, setIsEscalationSubmitting] = useState(false);
  const [submittedEscalationIds, setSubmittedEscalationIds] = useState<Set<string>>(new Set());
  const chatEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const escalationSubmissionKeys = useRef(new Map<string, string>());

  useEffect(() => {
    if (!selectedCourseId && courses.length) {
      setSelectedCourseId(courses[0].id);
    }
  }, [courses, selectedCourseId]);

  useEffect(() => {
    void (async () => {
      const sessions = await getAiTutorSessions();
      setCachedSessions(sessions);
    })();
  }, [setCachedSessions]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  useEffect(() => {
    if (!activeChatSessionId) {
      setMessages([welcomeMessage]);
      return;
    }

    void (async () => {
      const storedMessages = await getAiTutorSessionMessages(activeChatSessionId);
      setMessages(toUiMessages(storedMessages));
    })();
  }, [activeChatSessionId]);

  const handleDragEnd = (
    _event: MouseEvent | TouchEvent | PointerEvent,
    info: PanInfo,
  ) => {
    if (info.offset.x > 100 && info.velocity.x > 200) {
      router.back();
    }
  };

  async function refreshSessions(nextActiveSessionId?: string | null) {
    const sessions = await getAiTutorSessions();
    setCachedSessions(sessions);

    if (nextActiveSessionId && sessions.some((session) => session.id === nextActiveSessionId)) {
      setActiveChatSessionId(nextActiveSessionId);
    }
  }

  const submitMessage = async () => {
    if (!input.trim() || isLoading || !selectedCourseId) return;

    const userMessage = input.trim();
    setInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "48px";
    }

    const optimisticMessages: Message[] = [
      ...messages,
      { id: `user-${Date.now()}`, role: "user", content: userMessage },
    ];
    setMessages(optimisticMessages);
    setIsLoading(true);

    try {
      const result = await askAiTutor(userMessage, selectedCourseId, activeChatSessionId);
      const aiMessage: Message = {
        id: `ai-${Date.now()}`,
        role: "ai",
        content: result.response,
        category: result.category,
        isEscalated: result.isEscalated,
        originalQuestion: userMessage,
        sources: result.sources,
        canEscalate: true,
      };
      setMessages([...optimisticMessages, aiMessage]);
      if (result.sessionId) {
        await refreshSessions(result.sessionId);
      }
    } catch {
      setMessages([
        ...optimisticMessages,
        {
          id: `ai-error-${Date.now()}`,
          role: "ai",
          content: "서비스 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
          category: "수업 운영",
          isEscalated: true,
          originalQuestion: userMessage,
          canEscalate: true,
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    void submitMessage();
  };

  const handleAskProfessor = async (message: Message) => {
    if (!message.category || !selectedCourseId || !escalationDraft.trim() || isEscalationSubmitting) return;
    setIsEscalationSubmitting(true);
    const formData = new FormData();
    const submissionKey = escalationSubmissionKeys.current.get(message.id) ?? crypto.randomUUID();
    escalationSubmissionKeys.current.set(message.id, submissionKey);
    formData.set("courseId", selectedCourseId);
    formData.set("category", message.category);
    formData.set("question", escalationDraft);
    formData.set("submissionKey", submissionKey);
    formData.set("isAnonymous", String(isEscalationAnonymous));
    try {
      const result = await submitQuestionToProfessor(formData);
      setEscalationMessage(result.message);
      if (result.ok) {
        setSubmittedEscalationIds((current) => new Set(current).add(message.id));
        setEditingEscalationId(null);
        setEscalationDraft("");
        setIsEscalationAnonymous(false);
      }
    } finally {
      setIsEscalationSubmitting(false);
    }
  };

  const handleNewChat = () => {
    setActiveChatSessionId(null);
    setMessages([welcomeMessage]);
    setEditingEscalationId(null);
    setEscalationDraft("");
    setIsEscalationAnonymous(false);
    setEscalationMessage("");
    setSubmittedEscalationIds(new Set());
    setIsChatSidebarOpen(false);
  };

  const handleDeleteSession = async (sessionId: string) => {
    const result = await deleteAiTutorSession(sessionId);
    if (!result.ok) {
      return;
    }

    const nextActiveSessionId = activeChatSessionId === sessionId ? null : activeChatSessionId;
    if (activeChatSessionId === sessionId) {
      setActiveChatSessionId(null);
      setMessages([welcomeMessage]);
    }
    await refreshSessions(nextActiveSessionId);
  };

  return (
    <motion.div
      className="relative flex h-full w-full bg-white"
      drag="x"
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={{ right: 0.5, left: 0 }}
      onDragEnd={handleDragEnd}
    >
      <AnimatePresence>
        {isChatSidebarOpen ? (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.5 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsChatSidebarOpen(false)}
              className="absolute inset-0 z-40 bg-black md:hidden"
            />
            <motion.div
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", bounce: 0, duration: 0.3 }}
              className="absolute z-50 flex h-full w-[280px] flex-col border-r border-gray-200 bg-gray-50 md:relative"
            >
              <div className="flex items-center justify-between border-b border-gray-200 bg-white p-4">
                <span className="font-semibold text-gray-800">채팅 기록</span>
                <Button variant="ghost" size="icon" onClick={() => setIsChatSidebarOpen(false)} className="md:hidden">
                  <ArrowLeft size={18} />
                </Button>
              </div>
              <div className="p-3">
                <Button
                  variant="outline"
                  className="w-full justify-start gap-2 border-dashed border-emerald-200 text-emerald-700 hover:border-emerald-300 hover:bg-emerald-50"
                  onClick={handleNewChat}
                >
                  <Plus size={16} />
                  새 대화 시작
                </Button>
              </div>
              <div className="flex-1 space-y-2 overflow-y-auto px-3 pb-4">
                {cachedSessions.map((session) => (
                  <button
                    key={session.id}
                    type="button"
                    onClick={() => {
                      setActiveChatSessionId(session.id);
                      setIsChatSidebarOpen(false);
                    }}
                    className={`group flex w-full items-center justify-between rounded-lg border p-3 text-left transition-colors ${
                      activeChatSessionId === session.id
                        ? "border-emerald-200 bg-white"
                        : "border-transparent hover:border-gray-200 hover:bg-white"
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-gray-700">{session.title}</div>
                      {session.last_message ? (
                        <div className="mt-1 truncate text-xs text-gray-400">{session.last_message}</div>
                      ) : null}
                    </div>
                    <span
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleDeleteSession(session.id);
                      }}
                      className="ml-3 shrink-0 text-gray-400 opacity-0 transition-opacity group-hover:opacity-100 hover:text-red-500"
                    >
                      <Trash2 size={14} />
                    </span>
                  </button>
                ))}
                {!cachedSessions.length ? (
                  <div className="rounded-lg bg-white px-4 py-6 text-center text-sm text-gray-400">
                    아직 저장된 대화가 없습니다.
                  </div>
                ) : null}
              </div>
            </motion.div>
          </>
        ) : null}
      </AnimatePresence>

      <div className="relative flex h-full w-full flex-1 flex-col bg-white">
        <div className="sticky top-0 z-10 flex h-[60px] items-center gap-3 border-b border-gray-100 bg-white/95 px-4 backdrop-blur-sm">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsChatSidebarOpen(!isChatSidebarOpen)}
            className="-ml-2 text-gray-500"
          >
            <Menu size={20} />
          </Button>
          <div className="flex-1">
            <h2 className="text-sm font-bold leading-tight text-gray-800">AI 비서 터티</h2>
            <p className="text-[11px] text-gray-500">강의 자료 기반 학습 도우미</p>
          </div>
          <Button variant="ghost" size="icon" onClick={() => router.back()} className="text-gray-500">
            <ArrowLeft size={20} />
          </Button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto bg-slate-50/50 p-4">
          {messages.map((m) => (
            <div key={m.id} className={`mx-auto flex w-full max-w-3xl gap-3 ${m.role === "user" ? "flex-row-reverse" : ""}`}>
              <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full shadow-sm ${m.role === "user" ? "bg-gray-100 text-gray-600" : "bg-emerald-100 text-emerald-600"}`}>
                {m.role === "user" ? <User size={16} strokeWidth={2.5} /> : <Bot size={18} strokeWidth={2.5} />}
              </div>

              <div className={`flex max-w-[80%] flex-col gap-2 ${m.role === "user" ? "items-end" : "items-start"}`}>
                <div className={`rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed shadow-sm ${
                  m.role === "user"
                    ? "rounded-tr-sm bg-emerald-600 text-white"
                    : "rounded-tl-sm border border-gray-100 bg-white text-gray-800"
                }`}>
                  <p className="whitespace-pre-wrap break-words">{m.content}</p>
                </div>

                {(m.category || m.isEscalated) ? (
                  <div className="mt-1 flex flex-col items-start gap-1.5">
                    <div className="flex items-center gap-1.5">
                      {m.category ? (
                        <span className="rounded-md border border-emerald-100 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-600">
                          {m.category}
                        </span>
                      ) : null}
                      {m.isEscalated ? (
                        <div className="flex items-center gap-1 rounded-md border border-rose-100 bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-500">
                          <AlertCircle size={12} strokeWidth={3} />
                          <span>확인 필요</span>
                        </div>
                      ) : null}
                    </div>
                    {m.sources?.length ? (
                      <div className="mt-1 flex flex-wrap gap-1.5 rounded-xl bg-slate-100 px-3 py-2 text-[11px] text-slate-500 shadow-sm">
                        <span className="font-medium text-slate-600">출처:</span>
                        {m.sources.map((source) => (
                          <span key={source.id} className="rounded-full bg-white/80 px-2 py-0.5 text-slate-600">
                            {source.type === "announcement" && source.createdAt ? `${source.label} (${source.createdAt.slice(0, 10)})` : source.label}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {m.canEscalate && m.originalQuestion && !submittedEscalationIds.has(m.id) ? (
                      <div className="mt-1 w-full rounded-2xl bg-rose-50 p-3 shadow-sm">
                        {editingEscalationId === m.id ? (
                          <div className="flex flex-col gap-2">
                            <p className="text-xs leading-5 text-rose-700">
                              AI 답변이 충분하지 않다면 내용을 수정해 교수님과 조교에게 질문 요청을 보낼 수 있습니다.
                            </p>
                            <select
                              aria-label="질문을 전달할 과목"
                              value={selectedCourseId}
                              onChange={(event) => setSelectedCourseId(event.target.value)}
                              className="rounded-xl bg-white px-3 py-2 text-xs text-slate-700 shadow-sm outline-none"
                            >
                              {courses.map((course) => (
                                <option key={course.id} value={course.id}>{course.name}</option>
                              ))}
                            </select>
                            <textarea
                              aria-label="교수님에게 전달할 질문"
                              value={escalationDraft}
                              onChange={(event) => setEscalationDraft(event.target.value)}
                              className="min-h-24 resize-y rounded-xl bg-white px-3 py-2 text-sm leading-6 text-slate-800 shadow-sm outline-none"
                            />
                            <label className="flex items-center gap-2 text-xs text-slate-600">
                              <input
                                type="checkbox"
                                checked={isEscalationAnonymous}
                                onChange={(event) => setIsEscalationAnonymous(event.target.checked)}
                                disabled={isEscalationSubmitting}
                              />
                              익명으로 질문하기
                            </label>
                            <div className="flex items-center gap-2">
                              <button
                                className="rounded-xl bg-rose-500 px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-rose-600 disabled:cursor-not-allowed disabled:opacity-50"
                                disabled={!selectedCourseId || !escalationDraft.trim() || isEscalationSubmitting}
                                onClick={() => handleAskProfessor(m)}
                                type="button"
                              >
                                {isEscalationSubmitting ? "전송 중..." : "확인하고 전달하기"}
                              </button>
                              <button
                                className="px-2 py-2 text-xs text-slate-500"
                                onClick={() => { setEditingEscalationId(null); setEscalationDraft(""); setIsEscalationAnonymous(false); }}
                                disabled={isEscalationSubmitting}
                                type="button"
                              >
                                취소
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            className="flex items-center gap-1.5 text-xs font-semibold text-rose-600"
                            onClick={() => { setEditingEscalationId(m.id); setEscalationDraft(m.originalQuestion ?? ""); setIsEscalationAnonymous(false); }}
                            type="button"
                          >
                            <Hand size={14} />
                            교수님에게 질문 전달하기
                          </button>
                        )}
                      </div>
                    ) : submittedEscalationIds.has(m.id) ? (
                      <p className="mt-1 text-xs font-medium text-emerald-600">교수님에게 질문이 성공적으로 전달되었습니다.</p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          ))}

          {isLoading ? (
            <div className="mx-auto flex w-full max-w-3xl gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 shadow-sm">
                <Bot size={18} strokeWidth={2.5} />
              </div>
              <div className="flex items-center gap-1.5 rounded-2xl rounded-tl-sm border border-gray-100 bg-white px-4 py-3">
                <motion.div animate={{ scale: [1, 1.2, 1], opacity: [0.4, 1, 0.4] }} transition={{ repeat: Infinity, duration: 1, delay: 0 }} className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                <motion.div animate={{ scale: [1, 1.2, 1], opacity: [0.4, 1, 0.4] }} transition={{ repeat: Infinity, duration: 1, delay: 0.2 }} className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                <motion.div animate={{ scale: [1, 1.2, 1], opacity: [0.4, 1, 0.4] }} transition={{ repeat: Infinity, duration: 1, delay: 0.4 }} className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              </div>
            </div>
          ) : null}

          {escalationMessage ? (
            <p className="mx-auto max-w-3xl text-sm text-gray-600" aria-live="polite">
              {escalationMessage}
            </p>
          ) : null}
          <div ref={chatEndRef} />
        </div>

        <div className="shrink-0 border-t border-gray-100 bg-white p-3 pb-safe">
          {!courses.length ? (
            <p className="mx-auto mb-2 max-w-3xl rounded-xl bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-700 shadow-sm">
              시간표에 등록된 과목이 없어 질문할 과목을 선택할 수 없습니다. 먼저 시간표에 과목을 추가해 주세요.
            </p>
          ) : null}
          <form onSubmit={handleSubmit} className="relative mx-auto flex max-w-3xl items-end gap-2">
            <select
              aria-label="AI 비서 터티 참고 과목"
              value={selectedCourseId}
              onChange={(event) => setSelectedCourseId(event.target.value)}
              className="hidden max-w-36 rounded-xl bg-slate-100 px-2 py-3 text-xs text-slate-600 shadow-sm outline-none md:block"
            >
              <option value="">과목 선택</option>
              {courses.map((course) => (
                <option key={course.id} value={course.id}>{course.name}</option>
              ))}
            </select>
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  if (textareaRef.current) {
                    textareaRef.current.style.height = "48px";
                  }
                  void submitMessage();
                }
              }}
              placeholder="학습과 관련된 무엇이든 물어보세요..."
              className="max-h-[120px] min-h-[48px] flex-1 resize-none overflow-y-auto rounded-2xl border-transparent bg-gray-100 px-4 py-3 text-[15px] transition-all placeholder:text-gray-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
              disabled={isLoading}
              rows={1}
              style={{ height: "48px" }}
            />
            <button
              type="submit"
              className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full transition-all ${
                input.trim() && !isLoading
                  ? "bg-emerald-600 text-white shadow-md hover:scale-105 hover:bg-emerald-700 active:scale-95"
                  : "cursor-not-allowed bg-gray-100 text-gray-400"
              }`}
              disabled={isLoading || !input.trim() || !selectedCourseId}
            >
              <Send size={20} className={input.trim() && !isLoading ? "translate-x-[1px] -translate-y-[1px]" : ""} />
            </button>
          </form>
          <p className="mx-auto mt-2 max-w-3xl pb-1 text-center text-[10px] text-gray-400">
            AI 비서 터티의 답변은 오류가 있을 수 있습니다. 중요한 평가 사항은 꼭 조교나 교수님께 확인해 주세요.
          </p>
        </div>
      </div>
    </motion.div>
  );
}
