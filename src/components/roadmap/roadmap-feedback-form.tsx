"use client";

import { useState, useTransition } from "react";
import { AlertCircle, Send } from "lucide-react";
import { submitRoadmapFeedback } from "@/services/roadmap-feedback.actions";

type RoadmapFeedbackFormProps = {
  courseCode: string;
  courseId: string;
  courseName: string;
};

export function RoadmapFeedbackForm({
  courseCode,
  courseId,
  courseName,
}: RoadmapFeedbackFormProps) {
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  function submitFeedback() {
    const formData = new FormData();
    formData.set("courseCode", courseCode);
    formData.set("courseId", courseId);
    formData.set("courseName", courseName);
    formData.set("reason", reason);

    setMessage("");
    startTransition(async () => {
      const result = await submitRoadmapFeedback(formData);
      setMessage(result.message);
      if (result.ok) {
        setReason("");
      }
    });
  }

  return (
    <section className="roadmap-feedback-card">
      <div>
        <span>
          <AlertCircle aria-hidden="true" />
        </span>
        <div>
          <h2>로드맵 정보가 이상한가요?</h2>
          <p>수정이 필요한 부분만 짧게 남기면 운영자가 먼저 확인합니다.</p>
        </div>
      </div>
      <textarea
        aria-label="로드맵 오류 제보 내용"
        onChange={(event) => setReason(event.target.value)}
        placeholder="예: 선수 지식 설명이 실제 강의계획서와 달라요."
        rows={3}
        value={reason}
      />
      <button
        className="button button-outline button-md"
        disabled={isPending}
        onClick={submitFeedback}
        type="button"
      >
        {isPending ? "보내는 중" : "간단히 수정 요청"}
        <Send size={15} aria-hidden="true" />
      </button>
      {message ? <p className="roadmap-feedback-message">{message}</p> : null}
    </section>
  );
}
