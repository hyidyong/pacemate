"use client";

import { useEffect, useMemo, useState } from "react";
import type { CurriculumPreview, SupportedCurriculumDepartment } from "@/types/curriculum";

type ElectronicEngineeringOnboardingWorkspaceProps = {
  previews: Partial<Record<SupportedCurriculumDepartment, CurriculumPreview>>;
};

const majorLabels: Record<SupportedCurriculumDepartment, string> = {
  law: "법학과",
  "electronic-engineering": "전자공학과",
};

const years = [1, 2, 3, 4] as const;
const semesters = [1, 2] as const;

function semesterOrder(grade: number, semester: number) {
  return (grade - 1) * 2 + semester;
}

function getDefaultCompletedCourseIds(
  preview: CurriculumPreview,
  selectedYear: number,
  selectedSemester: number,
) {
  const selectedOrder = semesterOrder(selectedYear, selectedSemester);
  return preview.courses
    .filter((course) => {
      if (!course.recommendedGrade) return false;
      if (course.recommendedSemester == null) return course.recommendedGrade < selectedYear;
      return semesterOrder(course.recommendedGrade, course.recommendedSemester) < selectedOrder;
    })
    .map((course) => course.id);
}

export function ElectronicEngineeringOnboardingWorkspace({
  previews,
}: ElectronicEngineeringOnboardingWorkspaceProps) {
  const availableMajors = useMemo(
    () => (Object.keys(previews) as SupportedCurriculumDepartment[]).filter((major) => previews[major]),
    [previews],
  );
  const [selectedMajor, setSelectedMajor] = useState<SupportedCurriculumDepartment | "">("");
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [selectedSemester, setSelectedSemester] = useState<1 | 2 | null>(null);
  const [completedCourseIds, setCompletedCourseIds] = useState<Set<string>>(() => new Set());

  const preview = selectedMajor ? previews[selectedMajor] ?? null : null;
  const canShowChecklist = Boolean(preview && selectedYear && selectedSemester);

  useEffect(() => {
    if (!preview || !selectedYear || !selectedSemester) {
      setCompletedCourseIds(new Set());
      return;
    }

    setCompletedCourseIds(new Set(getDefaultCompletedCourseIds(preview, selectedYear, selectedSemester)));
  }, [preview, selectedYear, selectedSemester]);

  const coursesByTerm = useMemo(() => {
    if (!preview) return [];
    const groups = new Map<string, { grade: number | null; semester: number | null; courseIds: string[] }>();

    for (const course of preview.courses) {
      const key = `${course.recommendedGrade ?? 0}-${course.recommendedSemester ?? 0}`;
      const group = groups.get(key) ?? {
        grade: course.recommendedGrade,
        semester: course.recommendedSemester,
        courseIds: [],
      };
      group.courseIds.push(course.id);
      groups.set(key, group);
    }

    return [...groups.values()]
      .sort((left, right) => semesterOrder(left.grade ?? 99, left.semester ?? 2) - semesterOrder(right.grade ?? 99, right.semester ?? 2))
      .map((group) => ({
        ...group,
        courses: preview.courses.filter((course) => group.courseIds.includes(course.id)),
      }));
  }, [preview]);

  function changeMajor(value: string) {
    setSelectedMajor(value as SupportedCurriculumDepartment);
    setSelectedYear(null);
    setSelectedSemester(null);
    setCompletedCourseIds(new Set());
  }

  function changeYear(value: string) {
    setSelectedYear(value ? Number(value) : null);
    setSelectedSemester(null);
    setCompletedCourseIds(new Set());
  }

  function toggleCourse(courseId: string) {
    setCompletedCourseIds((current) => {
      const next = new Set(current);
      if (next.has(courseId)) next.delete(courseId);
      else next.add(courseId);
      return next;
    });
  }

  return (
    <section className="space-y-5" aria-label="학업 정보 설정">
      <input name="department" type="hidden" value={selectedMajor} />
      <input name="grade" type="hidden" value={selectedYear ?? ""} />
      <input name="semester" type="hidden" value={selectedSemester ?? ""} />
      <input name="completedCourses" type="hidden" value={[...completedCourseIds].join(",")} />

      <section className="rounded-2xl bg-white p-5 shadow-sm sm:p-6">
        <p className="text-sm font-semibold text-emerald-700">Step 1</p>
        <h2 className="mt-1 text-xl font-bold text-slate-900">학과를 선택해 주세요</h2>
        <p className="mt-2 text-sm leading-6 text-slate-500">선택한 학과의 블루북 교육과정을 기준으로 이수 과목을 미리 표시해 드립니다.</p>
        <label className="mt-5 block">
          <span className="sr-only">학과 선택</span>
          <select
            aria-label="학과 선택"
            className="w-full appearance-none rounded-xl bg-slate-50 px-4 py-3 text-sm font-medium text-slate-800 shadow-sm outline-none transition-all duration-300 ease-in-out focus:bg-emerald-50 focus:ring-2 focus:ring-emerald-200"
            onChange={(event) => changeMajor(event.target.value)}
            value={selectedMajor}
          >
            <option value="">학과 선택</option>
            {availableMajors.map((major) => <option key={major} value={major}>{majorLabels[major]}</option>)}
          </select>
        </label>
      </section>

      <section
        aria-hidden={!selectedMajor}
        className={`overflow-hidden rounded-2xl bg-white shadow-sm transition-all duration-300 ease-in-out ${
          selectedMajor ? "max-h-80 translate-y-0 p-5 opacity-100 sm:p-6" : "max-h-0 -translate-y-2 p-0 opacity-0"
        }`}
      >
        <p className="text-sm font-semibold text-emerald-700">Step 2</p>
        <h2 className="mt-1 text-xl font-bold text-slate-900">현재 학년과 학기를 알려주세요</h2>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-600">학년</span>
            <select
              aria-label="학년 선택"
              className="w-full appearance-none rounded-xl bg-slate-50 px-4 py-3 text-sm font-medium text-slate-800 shadow-sm outline-none transition-all duration-300 ease-in-out focus:bg-emerald-50 focus:ring-2 focus:ring-emerald-200"
              onChange={(event) => changeYear(event.target.value)}
              value={selectedYear ?? ""}
            >
              <option value="">학년 선택</option>
              {years.map((year) => <option key={year} value={year}>{year}학년</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-600">학기</span>
            <select
              aria-label="학기 선택"
              className="w-full appearance-none rounded-xl bg-slate-50 px-4 py-3 text-sm font-medium text-slate-800 shadow-sm outline-none transition-all duration-300 ease-in-out focus:bg-emerald-50 focus:ring-2 focus:ring-emerald-200"
              disabled={!selectedYear}
              onChange={(event) => setSelectedSemester(event.target.value ? Number(event.target.value) as 1 | 2 : null)}
              value={selectedSemester ?? ""}
            >
              <option value="">학기 선택</option>
              {semesters.map((semester) => <option key={semester} value={semester}>{semester}학기</option>)}
            </select>
          </label>
        </div>
      </section>

      <section
        aria-hidden={!canShowChecklist}
        className={`overflow-hidden rounded-2xl bg-white shadow-sm transition-all duration-300 ease-in-out ${
          canShowChecklist ? "max-h-[5000px] translate-y-0 p-5 opacity-100 sm:p-6" : "max-h-0 -translate-y-2 p-0 opacity-0"
        }`}
      >
        <p className="text-sm font-semibold text-emerald-700">Step 3</p>
        <h2 className="mt-1 text-xl font-bold text-slate-900">이수한 과목을 확인해 주세요</h2>
        <p className="mt-2 text-sm leading-6 text-slate-500">선택한 학기 이전의 블루북 과목은 자동으로 체크됩니다. 실제로 듣지 않은 과목만 체크 해제해 주세요.</p>
        <div className="mt-5 space-y-4">
          {coursesByTerm.map((group) => (
            <section key={`${group.grade}-${group.semester}`} className="rounded-xl bg-slate-50 p-4 shadow-sm">
              <h3 className="text-sm font-bold text-slate-700">
                {group.grade && group.semester ? `${group.grade}학년 ${group.semester}학기` : "학년·학기 미지정 과목"}
              </h3>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {group.courses.map((course) => {
                  const checked = completedCourseIds.has(course.id);
                  return (
                    <label key={course.id} className={`flex cursor-pointer items-start gap-3 rounded-xl px-3 py-3 transition-colors ${checked ? "bg-emerald-50 text-emerald-900" : "bg-white text-slate-600"}`}>
                      <input checked={checked} className="mt-0.5 h-4 w-4 accent-emerald-600" onChange={() => toggleCourse(course.id)} type="checkbox" />
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold">{course.sourceCourseName}</span>
                        {course.isRequired ? <span className="mt-0.5 block text-xs text-emerald-700">블루북 필수 이수</span> : null}
                      </span>
                    </label>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </section>
    </section>
  );
}
