"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Check, CircleHelp, LockKeyhole } from "lucide-react";
import type { CurriculumPreview } from "@/types/curriculum";

type ElectronicEngineeringCurriculumPreviewProps = {
  preview: CurriculumPreview | null;
  checkedCourseIds: ReadonlySet<string>;
  onToggleCourse: (courseId: string) => void;
};

export function ElectronicEngineeringCurriculumPreview({
  preview,
  checkedCourseIds,
  onToggleCourse,
}: ElectronicEngineeringCurriculumPreviewProps) {
  const [selectedDepartment, setSelectedDepartment] = useState("electronic-engineering");

  const coursesByGrade = useMemo(() => {
    if (!preview) {
      return [] as Array<[number, CurriculumPreview["courses"]]>;
    }

    const groups = new Map<number, CurriculumPreview["courses"]>();
    for (const course of preview.courses) {
      const grade = course.recommendedGrade ?? 0;
      const group = groups.get(grade) ?? [];
      group.push(course);
      groups.set(grade, group);
    }

    return [...groups.entries()].sort(([left], [right]) => left - right);
  }, [preview]);

  return (
    <section className="onboarding-panel curriculum-preview-panel" aria-labelledby="curriculum-preview-title">
      <div className="curriculum-preview-heading">
        <div>
          <p className="curriculum-preview-kicker">온보딩 시연용</p>
          <h2 id="curriculum-preview-title">학과별 과목 체크</h2>
          <p className="curriculum-preview-description">
            과목명을 확인하고 이미 이수했거나 확인한 과목을 임시로 체크해 보세요.
          </p>
        </div>
        <label className="curriculum-department-select">
          <span>학과</span>
          <select
            value={selectedDepartment}
            onChange={(event) => setSelectedDepartment(event.target.value)}
            aria-label="온보딩 시연 학과 선택"
          >
            <option value="electronic-engineering">전자공학과</option>
            <option value="law" disabled>법학과 — 이번 화면 미지원</option>
          </select>
        </label>
      </div>

      {selectedDepartment !== "electronic-engineering" ? null : preview ? (
        <>
          <div className="curriculum-draft-warning" role="status">
            <AlertTriangle size={19} aria-hidden="true" />
            <div>
              <strong>참고용 draft curriculum입니다.</strong>
              <p>
                공식 자료 확인 전 상태이며, 이 체크 결과는 저장되지 않습니다. 공식 졸업 판정이나 진행률이 아닙니다.
              </p>
            </div>
          </div>

          <div className="curriculum-preview-summary" aria-live="polite">
            <div>
              <span>확인한 과목</span>
              <strong>{checkedCourseIds.size} / {preview.summary.courseCount}</strong>
            </div>
            <div>
              <span>자료 상태</span>
              <strong>{preview.version.sourceVerified ? "확인됨" : "확인 중"}</strong>
            </div>
            <div>
              <span>입력 방식</span>
              <strong>이 화면에서만 유지</strong>
            </div>
          </div>

          <div className="curriculum-uncertainty-note">
            <CircleHelp size={17} aria-hidden="true" />
            <span>
              학점, 과목코드, 정확한 학기, 필수·선택 여부는 공식 자료 미확인 상태라 표시하지 않습니다.
            </span>
          </div>

          <div className="curriculum-grade-groups">
            {coursesByGrade.map(([grade, courses]) => (
              <section className="curriculum-grade-group" key={grade}>
                <div className="curriculum-grade-heading">
                  <h3>{grade > 0 ? `${grade}학년` : "학년 확인 중"}</h3>
                  <span>{courses.length}개 과목</span>
                </div>
                <div className="curriculum-course-list">
                  {courses.map((course) => {
                    const checked = checkedCourseIds.has(course.id);
                    return (
                      <label className="curriculum-course-check" data-checked={checked} key={course.id}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => onToggleCourse(course.id)}
                        />
                        <span className="curriculum-course-checkmark" aria-hidden="true">
                          {checked ? <Check size={15} /> : null}
                        </span>
                        <span className="curriculum-course-copy">
                          <strong>{course.sourceCourseName}</strong>
                          <small>학년 정보만 확인됨 · 기타 정보 확인 중</small>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>

          <div className="curriculum-preview-footer">
            <LockKeyhole size={16} aria-hidden="true" />
            <span>학생 curriculum assignment와 student course records에는 반영되지 않습니다.</span>
          </div>
        </>
      ) : (
        <div className="curriculum-preview-empty" role="status">
          전자공학과 draft curriculum을 불러오지 못했습니다. 데이터 연결 상태를 확인해 주세요.
        </div>
      )}
    </section>
  );
}
