export const SUPPORTED_CURRICULUM_DEPARTMENTS = [
  "law",
  "electronic-engineering",
] as const;

export type SupportedCurriculumDepartment =
  (typeof SUPPORTED_CURRICULUM_DEPARTMENTS)[number];

export type CurriculumQueryKind = "preview" | "unsupported" | "not_found";

export type CurriculumVersionRow = {
  id: string;
  department_id: string;
  version_key: string;
  academic_year: number | null;
  version_label: string;
  admission_year_from: number | null;
  admission_year_to: number | null;
  status: "draft" | "active" | "archived";
  source_title: string;
  source_file: string;
  source_academic_year: number | null;
  source_edition: string | null;
  publication_date: string | null;
  source_verified: boolean;
  notes: string | null;
};

export type CurriculumCourseRow = {
  id: string;
  curriculum_version_id: string;
  course_id: string | null;
  source_course_name: string;
  source_course_code: string | null;
  credits: number | null;
  requirement_type: string;
  recommended_grade: number | null;
  recommended_semester: number | null;
  curriculum_level: string | null;
  is_required: boolean;
  source_page: number | null;
  sort_order: number;
  metadata: Record<string, unknown>;
};

export type CurriculumRequirementRow = {
  id: string;
  curriculum_version_id: string;
  requirement_code: string;
  requirement_type: string;
  title: string;
  minimum_credits: number | null;
  minimum_course_count: number | null;
  must_complete_all: boolean;
  rule_definition: Record<string, unknown>;
  source_page: number | null;
  is_required: boolean;
  sort_order: number;
};

export type CurriculumRequirementExceptionRow = {
  id: string;
  curriculum_version_id: string;
  exception_type: string;
  title: string;
  condition_definition: Record<string, unknown>;
  override_definition: Record<string, unknown>;
  priority: number;
  requires_manual_review: boolean;
  source_page: number | null;
  notes: string | null;
};

export type CareerTrackRow = {
  id: string;
  curriculum_version_id: string;
  track_code: string;
  track_name: string;
  category: string;
  description: string | null;
  source_page: number | null;
  sort_order: number;
  status: "draft" | "active" | "archived";
};

export type CareerTrackCourseRow = {
  id: string;
  career_track_id: string;
  curriculum_course_id: string | null;
  course_id: string | null;
  recommended_grade: number | null;
  recommended_semester: number | null;
  recommended_stage: string | null;
  priority: number;
  is_required: boolean;
  recommendation_type: string;
  explicitly_stated: boolean;
  source_page: number | null;
};

export type CurriculumVersion = {
  id: string;
  departmentId: string;
  versionKey: string;
  academicYear: number | null;
  versionLabel: string;
  admissionYearFrom: number | null;
  admissionYearTo: number | null;
  status: "draft" | "active" | "archived";
  sourceTitle: string;
  sourceFile: string;
  sourceAcademicYear: number | null;
  sourceEdition: string | null;
  publicationDate: string | null;
  sourceVerified: boolean;
  notes: string | null;
};

export type CurriculumCourse = {
  id: string;
  curriculumVersionId: string;
  courseId: string | null;
  sourceCourseName: string;
  sourceCourseCode: string | null;
  credits: number | null;
  requirementType: string;
  recommendedGrade: number | null;
  recommendedSemester: number | null;
  curriculumLevel: string | null;
  isRequired: boolean;
  sourcePage: number | null;
  sortOrder: number;
  metadata: Record<string, unknown>;
};

export type CurriculumRequirement = Omit<
  CurriculumRequirementRow,
  | "curriculum_version_id"
  | "requirement_code"
  | "requirement_type"
  | "minimum_credits"
  | "minimum_course_count"
  | "must_complete_all"
  | "rule_definition"
  | "source_page"
  | "is_required"
  | "sort_order"
> & {
  curriculumVersionId: string;
  requirementCode: string;
  requirementType: string;
  minimumCredits: number | null;
  minimumCourseCount: number | null;
  mustCompleteAll: boolean;
  ruleDefinition: Record<string, unknown>;
  sourcePage: number | null;
  isRequired: boolean;
  sortOrder: number;
};

export type CurriculumRequirementException = {
  id: string;
  curriculumVersionId: string;
  exceptionType: string;
  title: string;
  conditionDefinition: Record<string, unknown>;
  overrideDefinition: Record<string, unknown>;
  priority: number;
  requiresManualReview: boolean;
  sourcePage: number | null;
  notes: string | null;
};

export type CareerTrackCourse = {
  id: string;
  careerTrackId: string;
  curriculumCourseId: string | null;
  courseId: string | null;
  recommendedGrade: number | null;
  recommendedSemester: number | null;
  recommendedStage: string | null;
  priority: number;
  isRequired: boolean;
  recommendationType: string;
  explicitlyStated: boolean;
  sourcePage: number | null;
};

export type CareerTrack = {
  id: string;
  curriculumVersionId: string;
  trackCode: string;
  trackName: string;
  category: string;
  description: string | null;
  sourcePage: number | null;
  sortOrder: number;
  status: "draft" | "active" | "archived";
  courses: CareerTrackCourse[];
};

export type CurriculumSummary = {
  courseCount: number;
  exactMatchCount: number;
  unresolvedCourseCount: number;
  requirementCount: number;
  exceptionCount: number;
  careerTrackCount: number;
  seededCareerTrackCourseCount: number;
  heldUnresolvedCareerLinkCount: number;
};

export type CurriculumPreview = {
  kind: "preview";
  department: SupportedCurriculumDepartment;
  version: CurriculumVersion;
  courses: CurriculumCourse[];
  requirements: CurriculumRequirement[];
  exceptions: CurriculumRequirementException[];
  careerTracks: CareerTrack[];
  summary: CurriculumSummary;
};

export type UnsupportedCurriculumResult = {
  kind: "unsupported";
  department: string;
  supportedDepartments: readonly SupportedCurriculumDepartment[];
};

export type CurriculumNotFoundResult = {
  kind: "not_found";
  department: SupportedCurriculumDepartment;
  versionKey: string;
};

export type CurriculumQueryResult =
  | CurriculumPreview
  | UnsupportedCurriculumResult
  | CurriculumNotFoundResult;

export type CurriculumSummaryResult =
  | {
      kind: "summary";
      department: SupportedCurriculumDepartment;
      version: CurriculumVersion;
      summary: CurriculumSummary;
    }
  | UnsupportedCurriculumResult
  | CurriculumNotFoundResult;

export function resolveSupportedDepartment(
  department: string,
): SupportedCurriculumDepartment | null {
  return (SUPPORTED_CURRICULUM_DEPARTMENTS as readonly string[]).includes(department)
    ? (department as SupportedCurriculumDepartment)
    : null;
}

export function createUnsupportedCurriculumResult(
  department: string,
): UnsupportedCurriculumResult {
  return {
    kind: "unsupported",
    department,
    supportedDepartments: SUPPORTED_CURRICULUM_DEPARTMENTS,
  };
}

export function mapCurriculumCourseRow(row: CurriculumCourseRow): CurriculumCourse {
  return {
    id: row.id,
    curriculumVersionId: row.curriculum_version_id,
    courseId: row.course_id,
    sourceCourseName: row.source_course_name,
    sourceCourseCode: row.source_course_code,
    credits: row.credits,
    requirementType: row.requirement_type,
    recommendedGrade: row.recommended_grade,
    recommendedSemester: row.recommended_semester,
    curriculumLevel: row.curriculum_level,
    isRequired: row.is_required,
    sourcePage: row.source_page,
    sortOrder: row.sort_order,
    metadata: row.metadata,
  };
}
