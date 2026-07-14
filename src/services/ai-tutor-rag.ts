export type TutorKnowledgeSourceType =
  | "syllabus"
  | "announcement"
  | "public_qa"
  | "bluebook";

export type TutorKnowledgeSource = {
  id: string;
  courseId: string;
  type: TutorKnowledgeSourceType;
  title: string;
  content: string;
  createdAt: string | null;
};

export type RankedTutorKnowledgeSource = TutorKnowledgeSource & { score: number };

const sourcePriority: Record<TutorKnowledgeSourceType, number> = {
  syllabus: 400,
  announcement: 300,
  public_qa: 200,
  bluebook: 100,
};

function tokens(value: string) {
  return new Set(
    value
      .normalize("NFKC")
      .toLocaleLowerCase("ko-KR")
      .split(/[^\p{L}\p{N}]+/u)
      .filter((token) => token.length >= 2),
  );
}

export function selectTutorKnowledgeSources(input: {
  courseId: string;
  question: string;
  sources: readonly TutorKnowledgeSource[];
  limit?: number;
}): RankedTutorKnowledgeSource[] {
  const questionTokens = tokens(input.question);
  if (!questionTokens.size) return [];

  return input.sources
    .flatMap((source) => {
      if (source.courseId !== input.courseId) return [];
      const sourceTokens = tokens(`${source.title} ${source.content}`);
      const overlap = [...questionTokens].filter((token) => sourceTokens.has(token)).length;
      if (!overlap) return [];
      return [{ ...source, score: sourcePriority[source.type] + overlap * 10 }];
    })
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, input.limit ?? 6);
}

export function sanitizeTutorCitations(
  citationIds: readonly string[],
  sources: readonly Pick<TutorKnowledgeSource, "id">[],
) {
  const available = new Set(sources.map((source) => source.id));
  return [...new Set(citationIds.filter((id) => available.has(id)))].slice(0, 4);
}
