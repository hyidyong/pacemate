export type CourseKnowledgeSourceType =
  | "faq"
  | "syllabus"
  | "weekly_plan"
  | "notice"
  | "professor_answer";

export type CourseKnowledgeSource = {
  id: string;
  courseId: string;
  type: CourseKnowledgeSourceType;
  title: string;
  content: string;
  approved: boolean;
};

export type RankedCourseKnowledgeSource = CourseKnowledgeSource & {
  score: number;
};

function normalize(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[^0-9a-z가-힣\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function keywords(value: string) {
  return new Set(normalize(value).split(" ").filter((token) => token.length >= 2));
}

export function selectGroundedCourseSources(input: {
  courseId: string;
  question: string;
  sources: readonly CourseKnowledgeSource[];
  limit?: number;
}): RankedCourseKnowledgeSource[] {
  const normalizedQuestion = normalize(input.question);
  const questionKeywords = keywords(input.question);
  if (!normalizedQuestion || !questionKeywords.size) return [];

  return input.sources
    .flatMap((source) => {
      if (!source.approved || source.courseId !== input.courseId) return [];
      const normalizedTitle = normalize(source.title);
      const sourceKeywords = keywords(`${source.title} ${source.content}`);
      const overlap = [...questionKeywords].filter((token) => sourceKeywords.has(token)).length;
      const exactFaq = source.type === "faq" && normalizedTitle === normalizedQuestion;
      if (!exactFaq && overlap === 0) return [];
      const score = (exactFaq ? 100 : 0) + overlap * 10 + (source.type === "faq" ? 3 : 0);
      return [{ ...source, score }];
    })
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, input.limit ?? 8);
}
