export type SyllabusParsingStatus = "pending" | "processing" | "completed" | "failed";

export type ParsedSyllabus = {
  academicYear: number | null;
  semester: number | null;
  course: {
    name: string | null;
    code: string | null;
    university: string | null;
    department: string | null;
    classification: string | null;
    credits: number | null;
    professorName: string | null;
    classroom: string | null;
    targetGrade: string | null;
    description: string | null;
    objectives: string | null;
    prerequisites: string | null;
    usage: string | null;
  };
  schedules: Array<{
    dayOfWeek: string;
    startTime: string;
    endTime: string;
    classroom: string | null;
  }>;
  assessments: Array<{
    type: string;
    title: string;
    weightPercent: number | null;
    description: string | null;
  }>;
  weeks: Array<{
    weekNumber: number;
    title: string | null;
    description: string | null;
    isExamWeek: boolean;
    examType: "midterm" | "final" | null;
    sourceText: string | null;
  }>;
  warnings: string[];
};

export type SyllabusIngestionRecord = {
  id: string;
  courseId: string;
  sourceName: string | null;
  originalFilename: string | null;
  storagePath: string | null;
  mimeType: string | null;
  parsingStatus: SyllabusParsingStatus;
  parsingError: string | null;
  rawExtractedText: string | null;
  parsedData: Partial<ParsedSyllabus>;
  createdAt: string;
  updatedAt: string;
};
