"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  ArrowRight,
  BookOpenCheck,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock3,
  MapPin,
  Sparkles,
} from "lucide-react";
import type { RoadmapCourse } from "@/data/roadmap-explorer";

type RoadmapExplorerProps = {
  semesterLabel: string;
  semesterSummary: string;
  totalCredit: number;
  studentType: string;
  personalizationNotes: string[];
  courses: RoadmapCourse[];
};

const priorityLabels: Record<RoadmapCourse["priority"], string> = {
  core: "핵심",
  recommended: "추천",
  support: "보조",
};

export function RoadmapExplorer({
  semesterLabel,
  semesterSummary,
  totalCredit,
  studentType,
  personalizationNotes,
  courses,
}: RoadmapExplorerProps) {
  const [selectedCourseId, setSelectedCourseId] = useState(courses[0]?.id ?? "");

  const selectedCourse = useMemo(
    () => courses.find((course) => course.id === selectedCourseId) ?? courses[0],
    [courses, selectedCourseId],
  );

  if (!selectedCourse) {
    return (
      <section className="section">
        <div className="roadmap-empty">
          <BookOpenCheck aria-hidden="true" />
          <p>이번 학기 시간표를 불러오면 과목별 로드맵을 보여줄게요.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="section roadmap-shell" data-testid="roadmap-explorer">
      <div className="roadmap-summary">
        <div>
          <span>{semesterLabel}</span>
          <strong>{studentType}</strong>
          <p>{semesterSummary}</p>
        </div>
        <div className="roadmap-credit">
          <CalendarDays aria-hidden="true" />
          <span>{totalCredit}학점</span>
        </div>
      </div>
      <div className="roadmap-personal-notes" aria-label="개인 맞춤 기준">
        {personalizationNotes.map((note) => (
          <span key={note}>{note}</span>
        ))}
      </div>

      <div className="roadmap-workspace">
        <div className="roadmap-timetable" aria-label="이번 학기 시간표">
          <div className="roadmap-panel-heading">
            <h2>이번 학기 시간표</h2>
            <p>과목을 누르면 추천 로드맵이 바뀝니다.</p>
          </div>
          <div className="roadmap-course-list">
            {courses.map((course) => {
              const isSelected = course.id === selectedCourse.id;

              return (
                <button
                  aria-pressed={isSelected}
                  className="roadmap-course-button"
                  data-selected={isSelected}
                  data-testid={`roadmap-course-${course.id}`}
                  key={course.id}
                  onClick={() => setSelectedCourseId(course.id)}
                  type="button"
                >
                  <span className="roadmap-course-meta">
                    <span>{priorityLabels[course.priority]}</span>
                    <span>{course.category}</span>
                    <span>{course.credit}학점</span>
                  </span>
                  <strong>{course.name}</strong>
                  <span className="roadmap-course-reason">{course.shortReason}</span>
                  <span className="roadmap-course-time">
                    <Clock3 size={14} aria-hidden="true" />
                    {course.dayLabel} {course.timeLabel}
                  </span>
                  <span className="roadmap-course-time">
                    <MapPin size={14} aria-hidden="true" />
                    {course.classroom} · {course.professor}
                  </span>
                  <ChevronRight className="roadmap-course-arrow" aria-hidden="true" />
                </button>
              );
            })}
          </div>
        </div>

        <article className="roadmap-detail" data-testid="roadmap-detail">
          <header className="roadmap-detail-header">
            <span className="status-line">
              <Sparkles size={15} aria-hidden="true" />
              AI 추천 초안
            </span>
            <div>
              <h2>{selectedCourse.name}</h2>
              <p>
                {selectedCourse.code} · {selectedCourse.professor} ·{" "}
                {selectedCourse.dayLabel} {selectedCourse.timeLabel}
              </p>
            </div>
            <Link
              className="roadmap-detail-link"
              data-testid="roadmap-selected-detail-link"
              href={`/roadmap/${selectedCourse.id}`}
            >
              과목 상세로 들어가기
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </header>

          <div className="roadmap-detail-section">
            <h3>추천 수강 순서</h3>
            <ol className="roadmap-phase-list">
              {selectedCourse.order.map((phase) => (
                <li key={phase.label}>
                  <span>{phase.label}</span>
                  <div>
                    <strong>{phase.title}</strong>
                    <p>{phase.reason}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          <div className="roadmap-detail-section">
            <h3>알고 있어야 할 기초 지식</h3>
            <div className="roadmap-tags">
              {selectedCourse.basics.map((basic) => (
                <span key={basic}>{basic}</span>
              ))}
            </div>
          </div>

          <div className="roadmap-method-grid">
            <RoadmapMethodCard
              icon={<BookOpenCheck aria-hidden="true" />}
              items={selectedCourse.generalStudyMethod}
              title="학습 방법"
            />
            <RoadmapMethodCard
              icon={<CheckCircle2 aria-hidden="true" />}
              items={selectedCourse.courseStudyMethod}
              title="해당 수업 학습 방법"
            />
          </div>

          <div className="roadmap-detail-section">
            <div className="flex items-center gap-2 mb-4">
              <h3>예습 및 복습 가이드</h3>
              <span className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-full font-bold">Beta</span>
            </div>
            <div className="bg-muted/50 p-4 rounded-xl text-sm leading-relaxed whitespace-pre-wrap">
              {`[예습 가이드]
- 이번 주차 주요 개념: ${selectedCourse.weeklyFocus[0] || "기본 개념"} 이해하기
- 강의 전에 미리 읽어볼 내용: ${selectedCourse.basics[0] || "선수 지식"} 관련 교재 파트 가볍게 훑어보기

[복습 퀴즈]
- 오늘 배운 내용 중 가장 중요했던 핵심 키워드 3가지는 무엇인가요?
- 해당 키워드를 활용해 짧은 문장으로 배운 내용을 요약해보세요. (스스로에게 설명하기)`}
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}

function RoadmapMethodCard({
  icon,
  items,
  title,
}: {
  icon: React.ReactNode;
  items: string[];
  title: string;
}) {
  return (
    <div className="roadmap-method-card">
      <div className="roadmap-method-title">
        <span>{icon}</span>
        <h3>{title}</h3>
      </div>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
