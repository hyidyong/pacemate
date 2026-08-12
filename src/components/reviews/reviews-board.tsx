"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Send, Star } from "lucide-react";
import type { CourseSummary } from "@/services/course.service";
import { createCourseReview } from "@/services/reviews.actions";
import type { CourseReview } from "@/services/reviews.service";

const gradingStyles = ["시험 중심", "사례형", "과제 중심", "참여도 반영", "복합 평가"];

export function ReviewsBoard({
  courses,
  initialCourseId,
  reviews,
}: {
  courses: CourseSummary[];
  initialCourseId?: string;
  reviews: CourseReview[];
}) {
  const router = useRouter();
  const [courseId, setCourseId] = useState(courses[0]?.id ?? "");
  const [difficulty, setDifficulty] = useState("3");
  const [workload, setWorkload] = useState("3");
  const [gradingStyle, setGradingStyle] = useState(gradingStyles[0]);
  const [teamProject, setTeamProject] = useState("false");
  const [content, setContent] = useState("");
  const [filterCourseId, setFilterCourseId] = useState(initialCourseId ?? "all");
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  const filteredReviews = useMemo(
    () =>
      filterCourseId === "all"
        ? reviews
        : reviews.filter((review) => review.course_id === filterCourseId),
    [filterCourseId, reviews],
  );

  function submitReview() {
    const formData = new FormData();
    formData.set("courseId", courseId);
    formData.set("difficulty", difficulty);
    formData.set("workload", workload);
    formData.set("gradingStyle", gradingStyle);
    formData.set("teamProject", teamProject);
    formData.set("content", content);

    setMessage("");
    startTransition(async () => {
      const result = await createCourseReview(formData);
      setMessage(result.message);
      if (result.ok) {
        setContent("");
        // The list is server data; without a refresh the student was told
        // 등록했습니다 while the feed stayed unchanged (audit A-14).
        router.refresh();
      }
    });
  }

  return (
    <section className="section reviews-layout">
      <aside className="reviews-compose">
        <div className="community-section-heading">
          <h2>후기 작성</h2>
          <span>익명 요약</span>
        </div>
        <label className="field">
          <span>과목</span>
          <select value={courseId} onChange={(event) => setCourseId(event.target.value)}>
            {courses.map((course) => (
              <option key={course.id} value={course.id}>
                {course.name}
              </option>
            ))}
          </select>
        </label>
        <div className="reviews-rating-grid">
          <label className="field">
            <span>난이도</span>
            <select value={difficulty} onChange={(event) => setDifficulty(event.target.value)}>
              {[1, 2, 3, 4, 5].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>학습량</span>
            <select value={workload} onChange={(event) => setWorkload(event.target.value)}>
              {[1, 2, 3, 4, 5].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="reviews-rating-grid">
          <label className="field">
            <span>평가 방식</span>
            <select value={gradingStyle} onChange={(event) => setGradingStyle(event.target.value)}>
              {gradingStyles.map((style) => (
                <option key={style} value={style}>
                  {style}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>팀플</span>
            <select value={teamProject} onChange={(event) => setTeamProject(event.target.value)}>
              <option value="false">없음/적음</option>
              <option value="true">있음</option>
            </select>
          </label>
        </div>
        <label className="field">
          <span>수강 팁</span>
          <textarea
            onChange={(event) => setContent(event.target.value)}
            placeholder="예: 판례 키워드 위주로 복습하면 시험 준비가 수월했어요."
            rows={5}
            value={content}
          />
        </label>
        <button
          className="button button-default button-md"
          disabled={isPending}
          onClick={submitReview}
          type="button"
        >
          {isPending ? "등록 중" : "후기 등록"}
          <Send size={15} aria-hidden="true" />
        </button>
        {message ? <p className="support-result">{message}</p> : null}
      </aside>

      <main className="reviews-feed">
        <div className="reviews-filter">
          <select value={filterCourseId} onChange={(event) => setFilterCourseId(event.target.value)}>
            <option value="all">전체 과목</option>
            {courses.map((course) => (
              <option key={course.id} value={course.id}>
                {course.name}
              </option>
            ))}
          </select>
        </div>
        <div className="reviews-list">
          {filteredReviews.length ? (
            filteredReviews.map((review) => (
              <article key={review.id}>
                <span>{review.course?.name ?? "과목 미지정"}</span>
                <strong>{review.grading_style ?? "평가 방식 미입력"}</strong>
                <div className="reviews-score-row">
                  <small>
                    <Star aria-hidden="true" /> 난이도 {review.difficulty ?? "-"}
                  </small>
                  <small>학습량 {review.workload ?? "-"}</small>
                  <small>{review.team_project ? "팀플 있음" : "팀플 적음"}</small>
                </div>
                <p>{review.content}</p>
                <em>{new Date(review.created_at).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })}</em>
              </article>
            ))
          ) : (
            <div className="community-empty">
              <p>아직 등록된 후기가 없습니다.</p>
            </div>
          )}
        </div>
      </main>
    </section>
  );
}
