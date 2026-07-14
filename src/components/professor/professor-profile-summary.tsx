import type { ProfessorCourse, ProfessorProfile } from "@/services/professor.service";

type ProfessorProfileSummaryProps = {
  professor: ProfessorProfile;
  courses?: ProfessorCourse[];
};

export function ProfessorProfileSummary({
  professor,
  courses = [],
}: ProfessorProfileSummaryProps) {
  const departmentName = professor.department[0]?.name ?? "소속 미정";
  const courseNames = courses.length
    ? courses.map((course) => course.name).join(", ")
    : "등록된 담당 과목 없음";
  const email = professor.email ?? "등록된 이메일 없음";

  const metaItems = [
    { label: "소속", value: departmentName },
    { label: "담당 과목", value: courseNames },
    { label: "이메일", value: email },
  ];

  return (
    <section aria-label="교수 프로필">
      <article className="rounded-3xl border border-emerald-100 bg-white px-5 py-5 shadow-sm sm:px-6">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <h2 className="text-lg font-bold text-slate-800">{professor.name} 교수</h2>
          <span className="text-sm font-medium text-slate-500">
            {professor.office ?? "연구실 미정"}
          </span>
        </div>

        <dl className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm leading-6">
          {metaItems.map((item, index) => (
            <div className="flex min-w-0 items-center gap-x-3" key={item.label}>
              {index > 0 ? (
                <span aria-hidden="true" className="shrink-0 px-1 text-gray-300">
                  |
                </span>
              ) : null}
              <div className="min-w-0 break-words text-slate-700">
                <dt className="inline text-slate-500">{item.label}: </dt>
                <dd className="inline font-medium text-slate-800">{item.value}</dd>
              </div>
            </div>
          ))}
        </dl>

        {professor.bio ? (
          <p className="mt-3 text-sm leading-6 text-slate-600">{professor.bio}</p>
        ) : null}
      </article>
    </section>
  );
}
