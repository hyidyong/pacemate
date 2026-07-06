"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Send } from "lucide-react";
import { submitQuestionToProfessor } from "@/services/ask.actions";
import type { CounselingCourseOption } from "@/services/counseling.service";

export function AskProfessorForm({ 
  courses, 
  defaultQuestion 
}: { 
  courses: CounselingCourseOption[]; 
  defaultQuestion: string 
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [courseId, setCourseId] = useState(courses[0]?.id || "");
  const [professorId, setProfessorId] = useState(courses[0]?.professors[0]?.id || "");
  const [question, setQuestion] = useState(defaultQuestion);
  const [message, setMessage] = useState("");

  const selectedCourse = courses.find((c) => c.id === courseId);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!courseId || !professorId || !question.trim()) return;

    const formData = new FormData();
    formData.set("courseId", courseId);
    formData.set("professorId", professorId);
    formData.set("question", question);

    startTransition(async () => {
      const result = await submitQuestionToProfessor(formData);
      setMessage(result.message);
      setTimeout(() => setMessage(""), 3000);
      if (result.ok) {
        setQuestion("");
      }
    });
  };

  return (
    <>
      {message && (
        <div className={`fixed bottom-10 left-1/2 transform -translate-x-1/2 px-6 py-3 rounded-full shadow-xl z-50 text-white font-medium transition-all animate-in fade-in slide-in-from-bottom-5 ${message.includes("성공") ? "bg-emerald-600" : "bg-destructive"}`}>
          {message}
        </div>
      )}
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="flex flex-col gap-2">
            <span className="text-sm font-semibold text-muted-foreground">질문 대상 과목</span>
            <select 
              value={courseId}
              onChange={(e) => {
                setCourseId(e.target.value);
                const course = courses.find(c => c.id === e.target.value);
                if (course && course.professors.length > 0) {
                  setProfessorId(course.professors[0].id);
                } else {
                  setProfessorId("");
                }
              }}
              className="h-10 px-3 py-2 rounded-md border bg-background text-sm"
            >
              {courses.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
          
          <label className="flex flex-col gap-2">
            <span className="text-sm font-semibold text-muted-foreground">대상 교수/조교</span>
            <select 
              value={professorId}
              onChange={(e) => setProfessorId(e.target.value)}
              className="h-10 px-3 py-2 rounded-md border bg-background text-sm"
              disabled={!selectedCourse || selectedCourse.professors.length === 0}
            >
              {selectedCourse?.professors.map(p => (
                <option key={p.id} value={p.id}>{p.name} 교수님/조교님</option>
              ))}
            </select>
          </label>
        </div>

        <label className="flex flex-col gap-2">
          <span className="text-sm font-semibold text-muted-foreground">질문 내용</span>
          <textarea 
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="질문 내용을 자세히 적어주세요. (강의 내용, 학사 일정, 과제 등)"
            rows={6}
            className="px-3 py-3 rounded-md border bg-background text-sm resize-y"
            required
          />
        </label>

        <div className="flex justify-end gap-3 pt-4 border-t">
          <Button 
            type="button" 
            variant="outline" 
            onClick={() => router.back()}
            disabled={isPending}
          >
            취소
          </Button>
          <Button type="submit" disabled={isPending || !question.trim()}>
            <Send size={16} className="mr-2" />
            질문 제출하기
          </Button>
        </div>
      </form>
    </>
  );
}
