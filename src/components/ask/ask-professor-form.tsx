"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { submitQuestionToProfessor } from "@/services/ask.actions";
import {
  professorQuestionCategories,
  type ProfessorQuestionCategory,
  type ProfessorQuestionCourseOption,
} from "@/types/professor-questions";

export function AskProfessorForm({
  courses,
  defaultQuestion,
}: {
  courses: ProfessorQuestionCourseOption[];
  defaultQuestion: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [courseId, setCourseId] = useState(courses[0]?.id ?? "");
  const [category, setCategory] = useState<ProfessorQuestionCategory>("수업 운영");
  const [question, setQuestion] = useState(defaultQuestion);
  const [resultMessage, setResultMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const submissionKeyRef = useRef("");

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!courseId || !question.trim() || isPending) return;

    submissionKeyRef.current ||= crypto.randomUUID();
    const formData = new FormData();
    formData.set("courseId", courseId);
    formData.set("category", category);
    formData.set("question", question);
    formData.set("submissionKey", submissionKeyRef.current);

    startTransition(async () => {
      const result = await submitQuestionToProfessor(formData);
      setResultMessage({ ok: result.ok, text: result.message });
      if (result.ok) {
        setQuestion("");
        submissionKeyRef.current = "";
        // The 내 질문과 답변 list on this page is server data — without a
        // refresh the just-submitted question never appeared (audit A-13).
        router.refresh();
      }
    });
  }

  // The toast used to sit permanently over the mobile bottom nav.
  useEffect(() => {
    if (!resultMessage) return;
    const timer = setTimeout(() => setResultMessage(null), 5000);
    return () => clearTimeout(timer);
  }, [resultMessage]);

  return (
    <>
      {resultMessage ? (
        <div
          aria-live="polite"
          className={`fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] left-1/2 z-[60] -translate-x-1/2 rounded-full px-6 py-3 font-medium text-white shadow-xl md:bottom-10 ${resultMessage.ok ? "bg-emerald-600" : "bg-destructive"}`}
        >
          {resultMessage.text}
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="flex flex-col gap-2">
            <span className="text-sm font-semibold text-muted-foreground">질문 대상 과목</span>
            <select
              value={courseId}
              onChange={(event) => setCourseId(event.target.value)}
              className="h-10 rounded-md border bg-background px-3 py-2 text-sm"
              required
            >
              {courses.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-sm font-semibold text-muted-foreground">질문 분류</span>
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value as ProfessorQuestionCategory)}
              className="h-10 rounded-md border bg-background px-3 py-2 text-sm"
            >
              {professorQuestionCategories.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="flex flex-col gap-2">
          <span className="text-sm font-semibold text-muted-foreground">질문 내용</span>
          <textarea
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="강의 내용이나 수업 운영에 관한 질문을 자세히 적어 주세요."
            rows={6}
            maxLength={2000}
            className="resize-y rounded-md border bg-background px-3 py-3 text-sm"
            required
          />
        </label>

        {!courses.length ? (
          <p className="text-sm text-muted-foreground">
            담당 교수가 안전하게 연결된 수강 과목이 없습니다.
          </p>
        ) : null}

        <div className="flex justify-end gap-3 border-t pt-4">
          <Button type="button" variant="outline" onClick={() => router.back()} disabled={isPending}>
            취소
          </Button>
          <Button type="submit" disabled={isPending || !courseId || !question.trim()}>
            <Send size={16} className="mr-2" aria-hidden="true" />
            질문 제출하기
          </Button>
        </div>
      </form>
    </>
  );
}
