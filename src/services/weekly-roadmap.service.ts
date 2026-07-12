import type {
  AcademicTerm,
  CourseOffering,
  CourseWeeklyPlan,
  StudentWeeklyProgress,
} from "@/types/weekly-roadmap";

/** Server-only read contract for the applied weekly roadmap foundation. */
export interface WeeklyRoadmapService {
  getActiveAcademicTermForSession(): Promise<AcademicTerm | null>;
  getStudentCourseOfferingsForSession(): Promise<CourseOffering[]>;
  getCourseWeeklyPlanForSession(
    offeringId: string,
    weekNumber: number
  ): Promise<CourseWeeklyPlan | null>;
  getStudentWeeklyProgressForSession(
    offeringId: string,
    weekNumber: number
  ): Promise<StudentWeeklyProgress | null>;
}

