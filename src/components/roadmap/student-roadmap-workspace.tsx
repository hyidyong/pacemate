"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Check, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  generateStudentPersonalizedRoadmap,
  saveStudentRoadmapWeekProgress,
} from "@/services/student-roadmap.actions";

type Offering = { offeringId: string; courseId: string; courseName: string };
type Week = {
  week_number: number;
  baseline_title: string;
  baseline_topic: string;
  baseline_content: string;
  personalized_goal: string;
  learning_activities: unknown;
  review_guide: string;
};

type Props = {
  offerings: Offering[];
  selectedOfferingId: string;
  initialWeeks: Week[];
  completedWeeks: number[];
};

export function StudentRoadmapWorkspace({
  offerings,
  selectedOfferingId,
  initialWeeks,
  completedWeeks,
}: Props) {
  const router = useRouter();
  const [activeWeek, setActiveWeek] = useState(1);
  const [isPending, startTransition] = useTransition();
  const [savedWeeks, setSavedWeeks] = useState(completedWeeks);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setSavedWeeks(completedWeeks);
  }, [completedWeeks, selectedOfferingId]);

  const week = useMemo(
    () => initialWeeks.find((item) => item.week_number === activeWeek),
    [activeWeek, initialWeeks],
  );

  if (!offerings.length) {
    return (
      <section className="rounded-2xl bg-slate-50 p-8 text-center text-slate-500 shadow-sm">
        시간표에 추가된 과목이 없습니다. 시간표에서 과목을 추가한 뒤 로드맵을 생성해 주세요.
      </section>
    );
  }

  function selectOffering(nextOfferingId: string) {
    setActiveWeek(1);
    setMessage(null);
    router.push(`/roadmap?offering=${encodeURIComponent(nextOfferingId)}`);
  }

  function generateRoadmap() {
    startTransition(async () => {
      const result = await generateStudentPersonalizedRoadmap(selectedOfferingId);
      setMessage(result.message);
      if (result.ok) router.refresh();
    });
  }

  function saveProgress() {
    startTransition(async () => {
      const result = await saveStudentRoadmapWeekProgress(selectedOfferingId, activeWeek);
      setMessage(result.message);
      if (result.ok) {
        setSavedWeeks((weeks) => [...new Set([...weeks, activeWeek])]);
      }
    });
  }

  return (
    <section id="course-roadmap" className="rounded-3xl bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-emerald-700">과목별 로드맵</p>
          <select
            aria-label="로드맵 과목 선택"
            className="mt-2 rounded-xl bg-slate-50 px-3 py-2 text-sm shadow-sm"
            onChange={(event) => selectOffering(event.target.value)}
            value={selectedOfferingId}
          >
            {offerings.map((item) => (
              <option key={item.offeringId} value={item.offeringId}>
                {item.courseName}
              </option>
            ))}
          </select>
        </div>
        <button
          className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-shadow hover:shadow-md disabled:opacity-60"
          disabled={isPending}
          onClick={generateRoadmap}
          type="button"
        >
          <Sparkles size={16} />
          {isPending ? "로드맵 생성 중" : "로드맵 생성 / 업데이트"}
        </button>
      </div>

      {message ? <p className="mt-3 text-sm text-slate-600" role="status">{message}</p> : null}

      <div className="mt-5 flex gap-2 overflow-x-auto pb-1" aria-label="주차별 로드맵">
        {Array.from({ length: 15 }, (_, index) => index + 1).map((number) => {
          const completed = savedWeeks.includes(number);
          const stateClass = completed
            ? "bg-green-50 text-green-600 shadow-sm"
            : number === activeWeek
              ? "bg-blue-50 text-blue-600 shadow-sm"
              : "bg-gray-100 text-gray-500";

          return (
            <button
              aria-label={`${number}주차${completed ? " 진행 저장 완료" : ""}`}
              aria-pressed={number === activeWeek}
              className={`h-9 w-9 shrink-0 rounded-full text-sm font-semibold transition-colors ${stateClass}`}
              key={number}
              onClick={() => setActiveWeek(number)}
              type="button"
            >
              {completed ? <Check className="mx-auto" size={15} /> : number}
            </button>
          );
        })}
      </div>

      {week ? (
        <article id="learning-progress" className="mt-5 rounded-2xl bg-slate-50 p-5 shadow-sm">
          <p className="text-sm font-bold text-slate-900">{week.week_number}주차 · {week.baseline_title}</p>
          <p className="mt-2 text-sm text-slate-600">{week.personalized_goal}</p>
          <p className="mt-3 text-xs leading-5 text-slate-500">{week.review_guide}</p>
          <button
            className="mt-4 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-shadow hover:shadow-md disabled:opacity-60"
            disabled={isPending}
            onClick={saveProgress}
            type="button"
          >
            진행저장
          </button>
        </article>
      ) : (
        <div className="mt-5 rounded-2xl bg-slate-50 p-6 text-sm text-slate-500">
          로드맵 생성 버튼을 눌러 이 과목의 개인화 계획을 생성하세요.
        </div>
      )}
    </section>
  );
}
