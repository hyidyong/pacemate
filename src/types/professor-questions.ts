export const professorQuestionCategories = [
  "과목 정보",
  "학사 행정",
  "수업 운영",
  "로드맵",
  "상담 필요",
] as const;

export type ProfessorQuestionCategory = (typeof professorQuestionCategories)[number];

export const professorQuestionCategoryLabels: Record<ProfessorQuestionCategory, string> = {
  "과목 정보": "과목 정보",
  "학사 행정": "학사 행정",
  "수업 운영": "수업 운영",
  로드맵: "로드맵",
  "상담 필요": "상담 필요",
};

export type ProfessorQuestionStatus = "pending" | "assigned" | "answered" | "closed";
export type ProfessorQuestionSourceKind = "direct" | "tutor";
export type ProfessorQuestionAnswerMode = "manual" | "automatic" | null;

export type ProfessorQuestionCourseOption = {
  id: string;
  code: string;
  name: string;
};

export type ProfessorQuestion = {
  id: string;
  courseId: string;
  courseName: string;
  category: ProfessorQuestionCategory;
  question: string;
  status: ProfessorQuestionStatus;
  answer: string | null;
  createdAt: string;
  answeredAt: string | null;
  answerMode: ProfessorQuestionAnswerMode;
  sourceKind: ProfessorQuestionSourceKind;
  fingerprint: string;
};

export type ProfessorQuestionGroup = {
  key: string;
  courseId: string;
  courseName: string;
  category: ProfessorQuestionCategory;
  fingerprint: string;
  pendingCount: number;
  questions: ProfessorQuestion[];
};

export type ProfessorQuestionAutoReplyRule = {
  id: string;
  courseId: string | null;
  courseName: string | null;
  category: ProfessorQuestionCategory;
  pattern: string;
  answer: string;
  isEnabled: boolean;
};

export type ProfessorQuestionInbox = {
  groups: ProfessorQuestionGroup[];
  categoryCounts: Record<ProfessorQuestionCategory, number>;
  rules: ProfessorQuestionAutoReplyRule[];
};

export type StudentProfessorQuestion = Omit<ProfessorQuestion, "fingerprint">;

export type ProfessorQuestionCreateResult =
  | {
      ok: true;
      created: boolean;
      status: ProfessorQuestionStatus;
      answer: string | null;
      notificationDelivered: boolean;
    }
  | {
      ok: false;
      code: "unauthenticated" | "forbidden" | "invalid_input" | "route_not_found" | "database_write_failed";
    };
