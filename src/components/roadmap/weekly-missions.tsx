"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { generateWeeklyGuide, submitProgressFeedback } from "@/services/ai-tutor.actions";

export function WeeklyMissions({ studentId, courseId, currentWeek, initialGuide }: { studentId: string, courseId: string, currentWeek: number, initialGuide: any }) {
  const router = useRouter();
  const [guide, setGuide] = useState(initialGuide);
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState("");
  const [showFeedback, setShowFeedback] = useState(false);
  const [status, setStatus] = useState<{ text: string; ok: boolean } | null>(null);

  const handleGenerate = () => {
    setStatus(null);
    startTransition(async () => {
      const result = await generateWeeklyGuide(courseId, studentId, currentWeek);
      if (result) {
        setGuide(result);
      } else {
        // A falsy result used to re-enable the button with no message at all
        // — failure was indistinguishable from a no-op (audit A-16).
        setStatus({ text: "가이드를 생성하지 못했습니다. 잠시 후 다시 시도해 주세요.", ok: false });
      }
    });
  };

  const handleFeedbackSubmit = () => {
    setStatus(null);
    startTransition(async () => {
      await submitProgressFeedback(courseId, studentId, currentWeek, feedback);
      setStatus({ text: "다음 주차 가이드가 실제 진도에 맞게 조정되었습니다.", ok: true });
      setShowFeedback(false);
      // router.refresh() keeps scroll position, tab selection, and local
      // todo state — window.location.reload() destroyed all three.
      router.refresh();
    });
  };

  return (
    <div className="section" style={{ border: "1px solid var(--color-border)", padding: "16px", borderRadius: "8px", marginTop: "16px" }}>
      <div className="flex flex-wrap items-center gap-3">
        {/* Current-week indicator: the existing currentWeek prop (student_courses.current_week) shown inside a circle. */}
        <span
          data-testid="current-week-indicator"
          role="img"
          aria-label={`현재 ${currentWeek}주차`}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-600 text-base font-bold leading-none text-white shadow-sm"
        >
          {currentWeek}
        </span>
        <div className="min-w-0">
          <h3 className="m-0">주차별 맞춤 예습/복습 가이드</h3>
          <p className="m-0 text-xs font-semibold text-blue-700">현재 {currentWeek}주차</p>
        </div>
      </div>
      {status ? (
        <p
          role={status.ok ? "status" : "alert"}
          style={{ marginTop: "8px", fontSize: "13px", fontWeight: 600, color: status.ok ? "#047857" : "#dc2626" }}
        >
          {status.text}
        </p>
      ) : null}

      {!guide ? (
        <div style={{ marginTop: "12px" }}>
          <p>아직 이번 주차 가이드가 생성되지 않았습니다.</p>
          <Button onClick={handleGenerate} disabled={isPending}>
            {isPending ? "AI 튜터가 생성 중..." : "AI 가이드 생성하기"}
          </Button>
        </div>
      ) : (
        <div style={{ marginTop: "12px", display: "flex", flexDirection: "column", gap: "12px" }}>
          <div style={{ background: "var(--muted)", padding: "12px", borderRadius: "6px" }}>
            <strong>예상 진도:</strong>
            <p style={{ marginTop: "4px" }}>{guide.predicted_progress_text}</p>
          </div>
          <div style={{ background: "var(--accent)", padding: "12px", borderRadius: "6px" }}>
            <strong style={{ color: "var(--accent-foreground)" }}>예습 및 복습 가이드:</strong>
            <p style={{ marginTop: "4px", color: "var(--accent-foreground)" }}>{guide.prep_review_guide}</p>
          </div>
          
          <div style={{ marginTop: "8px" }}>
            {!showFeedback ? (
              <Button variant="outline" size="sm" onClick={() => setShowFeedback(true)}>
                ⚠️ 실제 학교 진도가 다른가요?
              </Button>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px", background: "#fff3e0", padding: "12px", borderRadius: "6px", border: "1px solid #ffe0b2" }}>
                <strong style={{ color: "#e65100" }}>실제 진도 보정 (피드백)</strong>
                <textarea 
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  placeholder="예: 교수님이 2단원까지만 나갔어요."
                  rows={2}
                  style={{ width: "100%", padding: "8px", borderRadius: "4px", border: "1px solid #ccc" }}
                />
                <div style={{ display: "flex", gap: "8px" }}>
                  <Button size="sm" onClick={handleFeedbackSubmit} disabled={isPending || !feedback}>
                    {isPending ? "AI 보정 중..." : "피드백 반영하기"}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setShowFeedback(false)}>취소</Button>
                </div>
                <small style={{ color: "#e65100" }}>피드백을 남기면 AI가 다음 주차 진도를 자동으로 재조정합니다.</small>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
