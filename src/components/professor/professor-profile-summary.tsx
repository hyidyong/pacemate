import type { ProfessorCourse, ProfessorProfile } from "@/services/professor.service";

type ProfessorProfileSummaryProps = {
  professor: ProfessorProfile;
  courses?: ProfessorCourse[];
};

export function ProfessorProfileSummary({ professor, courses = [] }: ProfessorProfileSummaryProps) {
  return (
    <section className="mx-auto w-full max-w-6xl px-4 pt-6 sm:px-6" aria-label="교수 프로필">
      <article className="rounded-2xl border border-emerald-100 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-bold text-slate-800">{professor.name} 교수</h2>
          <p className="text-sm text-slate-600">{professor.office ?? "연구실 미정"}</p>
        </div>
        {professor.bio ? <p className="mt-4 text-sm leading-6 text-slate-600">{professor.bio}</p> : null}
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-slate-500">소속</dt>
            <dd className="mt-1 font-medium text-slate-800">{professor.department[0]?.name ?? "소속 미정"}</dd>
          </div>
          <div>
            <dt className="text-slate-500">이메일</dt>
            <dd className="mt-1 font-medium text-slate-800">{professor.email ?? "등록된 이메일 없음"}</dd>
          </div>
          <div>
            <dt className="text-slate-500">담당 과목</dt>
            <dd className="mt-1 font-medium text-slate-800">
              {courses.length ? courses.map((course) => course.name).join(", ") : "등록된 담당 과목 없음"}
            </dd>
          </div>
        </dl>
      </article>
    </section>
  );
}
