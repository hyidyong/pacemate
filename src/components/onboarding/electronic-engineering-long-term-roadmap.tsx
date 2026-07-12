import { AlertTriangle, CheckCircle2, CircleDashed, Compass } from "lucide-react";
import type { LongTermRoadmap, LongTermRoadmapPhaseKey } from "@/types/long-term-roadmap";

type ElectronicEngineeringLongTermRoadmapProps = {
  roadmap: LongTermRoadmap | null;
};

const phaseIcons: Record<LongTermRoadmapPhaseKey, typeof Compass> = {
  previous: CheckCircle2,
  current: Compass,
  future: CircleDashed,
};

export function ElectronicEngineeringLongTermRoadmap({
  roadmap,
}: ElectronicEngineeringLongTermRoadmapProps) {
  if (!roadmap) {
    return null;
  }

  return (
    <section className="onboarding-panel long-term-roadmap-panel" aria-labelledby="long-term-roadmap-title">
      <div className="long-term-roadmap-heading">
        <div>
          <p className="curriculum-preview-kicker">추천 초안</p>
          <h2 id="long-term-roadmap-title">전자공학과 장기 학습 로드맵</h2>
          <p className="curriculum-preview-description">
            현재 학년과 임시 체크 상태를 기준으로 원본 학년 그룹을 보여줍니다.
          </p>
        </div>
        <span className="long-term-roadmap-status">공식 판정 아님</span>
      </div>

      <div className="long-term-roadmap-warning" role="status">
        <AlertTriangle size={18} aria-hidden="true" />
        <span>{roadmap.notices[0]} {roadmap.notices[1]}</span>
      </div>

      <div className="long-term-roadmap-summary" aria-live="polite">
        <div>
          <span>전체 과목</span>
          <strong>{roadmap.summary.totalCourseCount}</strong>
        </div>
        <div>
          <span>완료 체크</span>
          <strong>{roadmap.summary.completedCourseCount}</strong>
        </div>
        <div>
          <span>남은 과목</span>
          <strong>{roadmap.summary.remainingCourseCount}</strong>
        </div>
      </div>

      <div className="long-term-roadmap-phases">
        {(Object.keys(roadmap.phases) as LongTermRoadmapPhaseKey[]).map((phaseKey) => {
          const phase = roadmap.phases[phaseKey];
          const Icon = phaseIcons[phaseKey];
          return (
            <section className="long-term-roadmap-phase" key={phase.key}>
              <div className="long-term-roadmap-phase-heading">
                <Icon size={18} aria-hidden="true" />
                <div>
                  <h3>{phase.label}</h3>
                  <span>{phase.courses.length}개 과목</span>
                </div>
              </div>
              {phase.courses.length ? (
                <ul className="long-term-roadmap-course-list">
                  {phase.courses.map((course) => (
                    <li data-status={course.status} key={course.id}>
                      {course.status === "completed" ? (
                        <CheckCircle2 size={16} aria-label="완료 체크" />
                      ) : (
                        <CircleDashed size={16} aria-label="미이수" />
                      )}
                      <span>
                        <strong>{course.sourceCourseName}</strong>
                        <small>{course.recommendedGrade ? `${course.recommendedGrade}학년 원본 기준` : "학년 정보 확인 중"}</small>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="long-term-roadmap-empty">이 단계에 표시할 과목이 없습니다.</p>
              )}
            </section>
          );
        })}
      </div>

      <p className="long-term-roadmap-note">{roadmap.notices[2]} 학점·정확한 학기·필수 여부·선수과목은 이 화면에서 사용하지 않습니다.</p>
    </section>
  );
}
