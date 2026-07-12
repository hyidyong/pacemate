import type {
  AcademicTerm,
  CourseOffering,
  CourseWeeklyPlan,
  StudentCourseProgress,
  StudentWeeklyProgress,
} from "@/types/weekly-roadmap";

/**
 * Server-only contract for the weekly roadmap foundation.
 *
 * Implementations are intentionally deferred to 1-C. Keeping this contract
 * separate prevents the current dashboard from calling the new schema before
 * the migration has been reviewed and applied.
 */
export interface WeeklyRoadmapService {
  getActiveAcademicTerm(): Promise<AcademicTerm | null>;
  getCourseOfferingForStudent(
    studentId: string,
    courseId: string,
    termId?: string
  ): Promise<CourseOffering | null>;
  getWeeklyPlan(
    offeringId: string,
    weekNumber: number
  ): Promise<CourseWeeklyPlan | null>;
  getStudentWeeklyProgress(
    studentId: string,
    offeringId: string,
    weekNumber: number
  ): Promise<StudentWeeklyProgress | null>;
  getStudentCourseProgress(
    studentId: string,
    offeringId: string
  ): Promise<StudentCourseProgress | null>;
  saveStudentWeeklyProgress(
    input: Omit<
      StudentWeeklyProgress,
      "id" | "createdAt" | "updatedAt"
    >
  ): Promise<StudentWeeklyProgress>;
}

