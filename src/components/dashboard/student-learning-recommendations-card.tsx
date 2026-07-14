import type { StudentLearningRecommendationResult } from "@/services/student-learning-recommendations.server";

export function StudentLearningRecommendationsCard({ result }: { result: StudentLearningRecommendationResult }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="student-recommendations-title">
      <h2 id="student-recommendations-title" className="text-lg font-bold text-slate-900">다음 학습 추천</h2>
      {!result.ok ? (
        <p className="mt-4 text-sm text-slate-600">추천 근거를 불러오지 못했습니다.</p>
      ) : result.recommendations.length === 0 ? (
        <p className="mt-4 text-sm text-slate-600">표시할 추천이 없습니다.</p>
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {result.recommendations.map((item) => (
            <article key={`${item.type}-${item.weekNumber}`} className="rounded-xl border border-emerald-100 bg-emerald-50 p-4">
              <p className="text-xs font-semibold text-emerald-700">{item.courseName} · {item.weekNumber}주차</p>
              <h3 className="mt-1 font-bold text-slate-900">{item.title}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">{item.reason}</p>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
