"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import {
  BookOpenCheck,
  BrainCircuit,
  Check,
  LoaderCircle,
  MessageSquareText,
  Save,
  Sparkles,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  generateStudentPersonalizedRoadmap,
  saveStudentRoadmapWeekProgress,
} from "@/services/student-roadmap.actions";
import type {
  StudentDifficultyRating,
  StudentRoadmapCourseGuide,
  StudentWeeklyFeedbackDraft,
} from "@/types/student-weekly-progress";

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
  hasPersonalizedRoadmap: boolean;
  courseGuide: StudentRoadmapCourseGuide | null;
  initialWeeklyFeedback: StudentWeeklyFeedbackDraft[];
  suggestProfessorPlanRefresh?: boolean;
};

const DIFFICULTY_OPTIONS: Array<{
  value: StudentDifficultyRating;
  label: string;
  selectedClassName: string;
}> = [
  { value: "HIGH", label: "상", selectedClassName: "bg-rose-200 text-rose-800 shadow-sm" },
  { value: "MID", label: "중", selectedClassName: "bg-amber-200 text-amber-800 shadow-sm" },
  { value: "LOW", label: "하", selectedClassName: "bg-emerald-200 text-emerald-800 shadow-sm" },
];

function createFeedbackState(rows: StudentWeeklyFeedbackDraft[]) {
  return Object.fromEntries(rows.map((row) => [row.weekNumber, row])) as Record<number, StudentWeeklyFeedbackDraft>;
}

export function StudentRoadmapWorkspace({
  offerings,
  selectedOfferingId,
  initialWeeks,
  completedWeeks,
  hasPersonalizedRoadmap,
  courseGuide,
  initialWeeklyFeedback,
  suggestProfessorPlanRefresh = false,
}: Props) {
  const router = useRouter();
  const [activeWeek, setActiveWeek] = useState(1);
  const [isPending, startTransition] = useTransition();
  const [savedWeeks, setSavedWeeks] = useState(completedWeeks);
  const [message, setMessage] = useState<string | null>(null);
  const [showProfessorPlanRefresh, setShowProfessorPlanRefresh] = useState(suggestProfessorPlanRefresh);
  const [feedbackByWeek, setFeedbackByWeek] = useState(() => createFeedbackState(initialWeeklyFeedback));

  useEffect(() => setShowProfessorPlanRefresh(suggestProfessorPlanRefresh), [suggestProfessorPlanRefresh]);

  useEffect(() => {
    setSavedWeeks(completedWeeks);
  }, [completedWeeks, selectedOfferingId]);

  useEffect(() => {
    setFeedbackByWeek(createFeedbackState(initialWeeklyFeedback));
  }, [initialWeeklyFeedback, selectedOfferingId]);

  const week = useMemo(
    () => initialWeeks.find((item) => item.week_number === activeWeek),
    [activeWeek, initialWeeks],
  );
  const activeFeedback = feedbackByWeek[activeWeek] ?? {
    weekNumber: activeWeek,
    difficultyRating: null,
    personalMemo: "",
    professorMemo: "",
    updatedAt: null,
  };

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
    router.push(nextOfferingId ? `/roadmap?offering=${encodeURIComponent(nextOfferingId)}` : "/roadmap");
  }

  function generateRoadmap() {
    if (!selectedOfferingId) return;

    startTransition(async () => {
      const result = await generateStudentPersonalizedRoadmap(selectedOfferingId);
      setMessage(result.message);
      if (result.ok) router.refresh();
      if (result.ok) setShowProfessorPlanRefresh(false);
    });
  }

  function saveProgress() {
    if (!selectedOfferingId) return;

    startTransition(async () => {
      const result = await saveStudentRoadmapWeekProgress(selectedOfferingId, activeWeek, {
        difficultyRating: activeFeedback.difficultyRating,
        personalMemo: activeFeedback.personalMemo,
        professorMemo: activeFeedback.professorMemo,
      });
      setMessage(result.message);
      if (result.ok) {
        setSavedWeeks((weeks) => [...new Set([...weeks, activeWeek])]);
        setFeedbackByWeek((current) => ({
          ...current,
          [activeWeek]: { ...activeFeedback, updatedAt: new Date().toISOString() },
        }));
        router.refresh();
      }
    });
  }

  function updateActiveFeedback(patch: Partial<StudentWeeklyFeedbackDraft>) {
    setFeedbackByWeek((current) => ({
      ...current,
      [activeWeek]: { ...activeFeedback, ...patch, weekNumber: activeWeek },
    }));
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
            <option disabled value="">과목을 선택해 주세요</option>
            {offerings.map((item) => (
              <option key={item.offeringId} value={item.offeringId}>
                {item.courseName}
              </option>
            ))}
          </select>
        </div>
        <button
          className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-shadow hover:shadow-md disabled:opacity-60"
          disabled={isPending || !selectedOfferingId}
          onClick={generateRoadmap}
          type="button"
        >
          {isPending ? <LoaderCircle className="animate-spin" size={16} /> : <Sparkles size={16} />}
          {isPending ? "로드맵 생성 중" : "로드맵 생성 / 업데이트"}
        </button>
      </div>

      {message ? <p className="mt-3 text-sm text-slate-600" role="status">{message}</p> : null}

      {showProfessorPlanRefresh ? (
        <div className="mt-4 rounded-2xl bg-emerald-50 px-4 py-4 text-sm text-emerald-900">
          <p className="font-semibold">담당 교수님의 최신 주간 학습 계획이 도착했습니다.</p>
          <p className="mt-1 text-emerald-800">기존 학습 기록은 유지하고, 최신 계획을 반영해 개인 로드맵을 다시 만들 수 있습니다.</p>
          <button
            className="mt-3 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            disabled={isPending || !selectedOfferingId}
            onClick={generateRoadmap}
            type="button"
          >
            최신 교수 학습 계획 반영하여 로드맵 다시 생성하기
          </button>
        </div>
      ) : null}

      {!selectedOfferingId ? (
        <div className="mt-5 rounded-2xl bg-slate-50 p-6 text-sm text-slate-500">
          과목을 선택해 주세요. 선택 전에는 로드맵 데이터가 표시되지 않습니다.
        </div>
      ) : (
        <>
          {courseGuide ? (
            <section className="mt-6" aria-labelledby="roadmap-course-guide-title">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-600">Syllabus guide</p>
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${
                    courseGuide.personalized_content.is_applied
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-slate-100 text-slate-600"
                  }`}>
                    {courseGuide.personalized_content.is_applied ? "개인 맞춤 적용" : "기본 가이드"}
                  </span>
                </div>
                <h2 id="roadmap-course-guide-title" className="mt-1 text-xl font-bold text-slate-900">
                  {courseGuide.courseName} 학습 가이드
                </h2>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{courseGuide.course_summary}</p>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <article aria-label="효과적인 학습 방법" className="rounded-2xl bg-blue-50/80 p-5 shadow-sm">
                  <div className="flex items-center gap-2 text-blue-700">
                    <BookOpenCheck size={19} aria-hidden="true" />
                    <h3 className="font-bold">{courseGuide.learning_method.title}</h3>
                  </div>
                  <p className="mt-3 whitespace-pre-line text-sm leading-6 text-slate-700">
                    {courseGuide.learning_method.content}
                  </p>
                </article>
                <article aria-label="필요한 선수 지식" className="rounded-2xl bg-violet-50/80 p-5 shadow-sm">
                  <div className="flex items-center gap-2 text-violet-700">
                    <BrainCircuit size={19} aria-hidden="true" />
                    <h3 className="font-bold">{courseGuide.prerequisites.title}</h3>
                  </div>
                  <p className="mt-3 whitespace-pre-line text-sm leading-6 text-slate-700">
                    {courseGuide.prerequisites.content}
                  </p>
                </article>
                <article aria-label="주차별 예습/복습 가이드" className="rounded-2xl bg-amber-50/70 p-5 shadow-sm md:col-span-2">
                  <div className="flex items-center gap-2 text-amber-700">
                    <Sparkles size={19} aria-hidden="true" />
                    <h3 className="font-bold">{courseGuide.preview_review_guide.title}</h3>
                  </div>
                  <p className="mt-3 whitespace-pre-line text-sm leading-6 text-slate-700">
                    {courseGuide.preview_review_guide.content}
                  </p>
                </article>
                {courseGuide.personalized_content.is_applied ? (
                  <article className="rounded-2xl bg-emerald-50/80 p-5 shadow-sm md:col-span-2">
                    <p className="text-xs font-bold uppercase tracking-[0.14em] text-emerald-700">Personalized tips</p>
                    <h3 className="mt-1 font-bold text-slate-900">나에게 맞춘 추가 학습 팁</h3>
                    <p className="mt-3 whitespace-pre-line text-sm leading-6 text-slate-700">
                      {courseGuide.personalized_content.additional_tips}
                    </p>
                  </article>
                ) : null}
              </div>
            </section>
          ) : null}

          <div className="mt-7 flex items-end justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-600">Weekly learning log</p>
              <h2 className="mt-1 text-xl font-bold text-slate-900">주차별 강의와 학습 기록</h2>
            </div>
            <p className="hidden text-xs text-slate-500 sm:block">개인 메모는 교수 화면에 표시되지 않습니다.</p>
          </div>
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
            <article id="learning-progress" className="mt-5 overflow-hidden rounded-3xl bg-slate-50 shadow-sm">
              <div className="grid gap-0 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.35fr)]">
                <div className="bg-gradient-to-br from-blue-50 via-white to-emerald-50 p-5 sm:p-6">
                  <span className="inline-flex rounded-full bg-white px-3 py-1 text-xs font-bold text-blue-700 shadow-sm">
                    {week.week_number}주차
                  </span>
                  <h3 className="mt-4 text-xl font-bold text-slate-900">{week.baseline_title}</h3>
                  <p className="mt-2 text-sm font-medium text-slate-600">{week.baseline_topic}</p>
                  <p className="mt-5 text-sm leading-6 text-slate-700">{week.baseline_content}</p>
                  {hasPersonalizedRoadmap ? (
                    <div className="mt-5 rounded-2xl bg-white/85 p-4 shadow-sm">
                      <p className="text-xs font-bold text-emerald-700">나의 이번 주 목표</p>
                      <p className="mt-2 text-sm leading-6 text-slate-700">{week.personalized_goal}</p>
                      <p className="mt-3 text-xs leading-5 text-slate-500">{week.review_guide}</p>
                    </div>
                  ) : null}
                </div>

                <div className="bg-white p-5 sm:p-6">
                  <fieldset>
                    <legend className="text-sm font-bold text-slate-900">이번 주 학습 난이도</legend>
                    <p className="mt-1 text-xs text-slate-500">체감 난이도를 선택해 주세요.</p>
                    <div className="mt-4 flex gap-3">
                      {DIFFICULTY_OPTIONS.map((option) => {
                        const selected = activeFeedback.difficultyRating === option.value;
                        return (
                          <button
                            aria-label={`난이도 ${option.label}`}
                            aria-pressed={selected}
                            className={`h-12 w-12 rounded-full text-sm font-bold transition-all duration-200 ${
                              selected
                                ? `${option.selectedClassName} scale-105`
                                : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                            }`}
                            key={option.value}
                            onClick={() => updateActiveFeedback({ difficultyRating: option.value })}
                            type="button"
                          >
                            {option.label}
                          </button>
                        );
                      })}
                    </div>
                  </fieldset>

                  <div className="mt-6 grid gap-5">
                    <label className="block">
                      <span className="flex items-center justify-between gap-3 text-sm font-bold text-slate-900">
                        개인 메모
                        <span className="text-xs font-medium text-emerald-600">나만 볼 수 있어요</span>
                      </span>
                      <textarea
                        className="mt-2 min-h-28 w-full resize-y rounded-2xl bg-emerald-50/60 px-4 py-3 text-sm leading-6 text-slate-800 outline-none ring-1 ring-transparent transition focus:bg-white focus:ring-emerald-200"
                        maxLength={2000}
                        onChange={(event) => updateActiveFeedback({ personalMemo: event.target.value })}
                        placeholder="복습할 개념, 나만의 요약, 다음 학습 계획을 자유롭게 적어보세요."
                        value={activeFeedback.personalMemo}
                      />
                    </label>

                    <label className="block">
                      <span className="flex items-center gap-2 text-sm font-bold text-slate-900">
                        <MessageSquareText size={17} className="text-blue-600" aria-hidden="true" />
                        교수님 전달 메모
                      </span>
                      <textarea
                        className="mt-2 min-h-28 w-full resize-y rounded-2xl bg-blue-50/70 px-4 py-3 text-sm leading-6 text-slate-800 outline-none ring-1 ring-transparent transition focus:bg-white focus:ring-blue-200"
                        maxLength={2000}
                        onChange={(event) => updateActiveFeedback({ professorMemo: event.target.value })}
                        placeholder="교수님/조교님께 전달할 의견이나 질문을 적어주세요"
                        value={activeFeedback.professorMemo}
                      />
                    </label>
                  </div>

                  <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
                    <p className="text-xs text-slate-400">
                      {activeFeedback.updatedAt
                        ? `${new Date(activeFeedback.updatedAt).toLocaleDateString("ko-KR")} 저장됨`
                        : "아직 저장하지 않은 주차입니다."}
                    </p>
                    <button
                      className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:bg-emerald-700 hover:shadow-md disabled:opacity-60"
                      disabled={isPending}
                      onClick={saveProgress}
                      type="button"
                    >
                      {isPending ? <LoaderCircle className="animate-spin" size={17} /> : <Save size={17} />}
                      {isPending ? "저장 중" : "진행도 및 데이터 저장"}
                    </button>
                  </div>
                </div>
              </div>
            </article>
          ) : (
            <div className="mt-5 rounded-2xl bg-slate-50 p-6 text-sm text-slate-500">
              강의계획서의 주차별 정보를 불러오지 못했습니다. 과목 정보를 확인한 뒤 다시 시도해 주세요.
            </div>
          )}
        </>
      )}

      {hasPersonalizedRoadmap ? (
        <div className="mt-8 flex flex-col items-center gap-3 rounded-2xl bg-gray-50 px-5 py-6 text-center shadow-sm">
          <p className="text-xs text-gray-400">시간표나 온보딩 정보가 바뀌었나요?</p>
          <button
            className="inline-flex items-center gap-2 rounded-xl bg-gray-50 px-4 py-2.5 text-sm font-semibold text-gray-600 shadow-sm transition-colors hover:bg-gray-100 disabled:opacity-60"
            disabled={isPending}
            onClick={generateRoadmap}
            type="button"
          >
            {isPending ? <LoaderCircle className="animate-spin" size={16} /> : <Sparkles size={16} />}
            {isPending ? "로드맵 다시 생성 중" : "로드맵 다시 생성하기"}
          </button>
        </div>
      ) : null}
    </section>
  );
}
