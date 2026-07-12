import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  createUnsupportedCurriculumResult,
  mapCurriculumCourseRow,
  resolveSupportedDepartment,
  type CareerTrack,
  type CareerTrackCourse,
  type CareerTrackCourseRow,
  type CareerTrackRow,
  type CurriculumCourseRow,
  type CurriculumNotFoundResult,
  type CurriculumPreview,
  type CurriculumQueryResult,
  type CurriculumRequirement,
  type CurriculumRequirementException,
  type CurriculumRequirementExceptionRow,
  type CurriculumRequirementRow,
  type CurriculumSummary,
  type CurriculumSummaryResult,
  type CurriculumVersion,
  type CurriculumVersionRow,
  type SupportedCurriculumDepartment,
} from "@/types/curriculum";

const CURRICULUM_DEPARTMENT_NAMES: Record<SupportedCurriculumDepartment, string> = {
  law: "법학과",
  "electronic-engineering": "전자공학과",
};

const CURRICULUM_VERSION_KEYS: Record<SupportedCurriculumDepartment, string> = {
  law: "law-bluebook-reference-unknown",
  "electronic-engineering": "electronic-engineering-2026",
};

const HELD_UNRESOLVED_LINK_COUNTS: Record<SupportedCurriculumDepartment, number> = {
  law: 5,
  "electronic-engineering": 0,
};

const VERSION_COLUMNS =
  "id, department_id, version_key, academic_year, version_label, admission_year_from, admission_year_to, status, source_title, source_file, source_academic_year, source_edition, publication_date, source_verified, notes";
const COURSE_COLUMNS =
  "id, curriculum_version_id, course_id, source_course_name, source_course_code, credits, requirement_type, recommended_grade, recommended_semester, curriculum_level, is_required, source_page, sort_order, metadata";
const REQUIREMENT_COLUMNS =
  "id, curriculum_version_id, requirement_code, requirement_type, title, minimum_credits, minimum_course_count, must_complete_all, rule_definition, source_page, is_required, sort_order";
const EXCEPTION_COLUMNS =
  "id, curriculum_version_id, exception_type, title, condition_definition, override_definition, priority, requires_manual_review, source_page, notes";
const TRACK_COLUMNS =
  "id, curriculum_version_id, track_code, track_name, category, description, source_page, sort_order, status";
const TRACK_COURSE_COLUMNS =
  "id, career_track_id, curriculum_course_id, course_id, recommended_grade, recommended_semester, recommended_stage, priority, is_required, recommendation_type, explicitly_stated, source_page";

function mapVersion(row: CurriculumVersionRow): CurriculumVersion {
  return {
    id: row.id,
    departmentId: row.department_id,
    versionKey: row.version_key,
    academicYear: row.academic_year,
    versionLabel: row.version_label,
    admissionYearFrom: row.admission_year_from,
    admissionYearTo: row.admission_year_to,
    status: row.status,
    sourceTitle: row.source_title,
    sourceFile: row.source_file,
    sourceAcademicYear: row.source_academic_year,
    sourceEdition: row.source_edition,
    publicationDate: row.publication_date,
    sourceVerified: row.source_verified,
    notes: row.notes,
  };
}

function mapRequirement(row: CurriculumRequirementRow): CurriculumRequirement {
  return {
    id: row.id,
    curriculumVersionId: row.curriculum_version_id,
    requirementCode: row.requirement_code,
    requirementType: row.requirement_type,
    title: row.title,
    minimumCredits: row.minimum_credits,
    minimumCourseCount: row.minimum_course_count,
    mustCompleteAll: row.must_complete_all,
    ruleDefinition: row.rule_definition,
    sourcePage: row.source_page,
    isRequired: row.is_required,
    sortOrder: row.sort_order,
  };
}

function mapException(row: CurriculumRequirementExceptionRow): CurriculumRequirementException {
  return {
    id: row.id,
    curriculumVersionId: row.curriculum_version_id,
    exceptionType: row.exception_type,
    title: row.title,
    conditionDefinition: row.condition_definition,
    overrideDefinition: row.override_definition,
    priority: row.priority,
    requiresManualReview: row.requires_manual_review,
    sourcePage: row.source_page,
    notes: row.notes,
  };
}

function mapTrackCourse(row: CareerTrackCourseRow): CareerTrackCourse {
  return {
    id: row.id,
    careerTrackId: row.career_track_id,
    curriculumCourseId: row.curriculum_course_id,
    courseId: row.course_id,
    recommendedGrade: row.recommended_grade,
    recommendedSemester: row.recommended_semester,
    recommendedStage: row.recommended_stage,
    priority: row.priority,
    isRequired: row.is_required,
    recommendationType: row.recommendation_type,
    explicitlyStated: row.explicitly_stated,
    sourcePage: row.source_page,
  };
}

function mapTrack(row: CareerTrackRow, courses: CareerTrackCourse[]): CareerTrack {
  return {
    id: row.id,
    curriculumVersionId: row.curriculum_version_id,
    trackCode: row.track_code,
    trackName: row.track_name,
    category: row.category,
    description: row.description,
    sourcePage: row.source_page,
    sortOrder: row.sort_order,
    status: row.status,
    courses,
  };
}

function createSummary(
  department: SupportedCurriculumDepartment,
  courses: ReturnType<typeof mapCurriculumCourseRow>[],
  requirements: CurriculumRequirement[],
  exceptions: CurriculumRequirementException[],
  tracks: CareerTrack[],
): CurriculumSummary {
  const seededCareerTrackCourseCount = tracks.reduce(
    (count, track) => count + track.courses.length,
    0,
  );

  return {
    courseCount: courses.length,
    exactMatchCount: courses.filter((course) => course.courseId !== null).length,
    unresolvedCourseCount: courses.filter((course) => course.courseId === null).length,
    requirementCount: requirements.length,
    exceptionCount: exceptions.length,
    careerTrackCount: tracks.length,
    seededCareerTrackCourseCount,
    heldUnresolvedCareerLinkCount: HELD_UNRESOLVED_LINK_COUNTS[department],
  };
}

async function getDraftVersion(
  department: SupportedCurriculumDepartment,
): Promise<CurriculumVersionRow | null> {
  const supabase = createSupabaseAdminClient();
  const { data: departmentRow, error: departmentError } = await supabase
    .from("departments")
    .select("id")
    .eq("name", CURRICULUM_DEPARTMENT_NAMES[department])
    .maybeSingle();

  if (departmentError) {
    throw new Error(`Failed to load curriculum department: ${departmentError.message}`);
  }

  if (!departmentRow) {
    return null;
  }

  const { data, error } = await supabase
    .from("curriculum_versions")
    .select(VERSION_COLUMNS)
    .eq("department_id", departmentRow.id)
    .eq("version_key", CURRICULUM_VERSION_KEYS[department])
    .eq("status", "draft")
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load draft curriculum version: ${error.message}`);
  }

  return (data as CurriculumVersionRow | null) ?? null;
}

export async function getDraftCurriculumByDepartment(
  departmentInput: string,
): Promise<CurriculumQueryResult> {
  const department = resolveSupportedDepartment(departmentInput);

  if (!department) {
    return createUnsupportedCurriculumResult(departmentInput);
  }

  const versionRow = await getDraftVersion(department);
  if (!versionRow) {
    const result: CurriculumNotFoundResult = {
      kind: "not_found",
      department,
      versionKey: CURRICULUM_VERSION_KEYS[department],
    };
    return result;
  }

  const supabase = createSupabaseAdminClient();
  const [coursesResult, requirementsResult, exceptionsResult, tracksResult] = await Promise.all([
    supabase
      .from("curriculum_courses")
      .select(COURSE_COLUMNS)
      .eq("curriculum_version_id", versionRow.id)
      .order("sort_order", { ascending: true }),
    supabase
      .from("curriculum_requirements")
      .select(REQUIREMENT_COLUMNS)
      .eq("curriculum_version_id", versionRow.id)
      .order("sort_order", { ascending: true }),
    supabase
      .from("curriculum_requirement_exceptions")
      .select(EXCEPTION_COLUMNS)
      .eq("curriculum_version_id", versionRow.id)
      .order("priority", { ascending: true }),
    supabase
      .from("career_tracks")
      .select(TRACK_COLUMNS)
      .eq("curriculum_version_id", versionRow.id)
      .order("sort_order", { ascending: true }),
  ]);

  const firstError =
    coursesResult.error ??
    requirementsResult.error ??
    exceptionsResult.error ??
    tracksResult.error;
  if (firstError) {
    throw new Error(`Failed to load draft curriculum details: ${firstError.message}`);
  }

  const trackRows = (tracksResult.data ?? []) as CareerTrackRow[];
  const trackIds = trackRows.map((track) => track.id);
  let trackCourseRows: CareerTrackCourseRow[] = [];

  if (trackIds.length > 0) {
    const { data, error } = await supabase
      .from("career_track_courses")
      .select(TRACK_COURSE_COLUMNS)
      .in("career_track_id", trackIds)
      .order("priority", { ascending: true });

    if (error) {
      throw new Error(`Failed to load career track courses: ${error.message}`);
    }

    trackCourseRows = (data ?? []) as CareerTrackCourseRow[];
  }

  const courses = ((coursesResult.data ?? []) as CurriculumCourseRow[]).map(
    mapCurriculumCourseRow,
  );
  const requirements = ((requirementsResult.data ?? []) as CurriculumRequirementRow[]).map(
    mapRequirement,
  );
  const exceptions = ((exceptionsResult.data ?? []) as CurriculumRequirementExceptionRow[]).map(
    mapException,
  );
  const careerTracks = trackRows.map((track) =>
    mapTrack(
      track,
      trackCourseRows
        .filter((trackCourse) => trackCourse.career_track_id === track.id)
        .map(mapTrackCourse),
    ),
  );

  const preview: CurriculumPreview = {
    kind: "preview",
    department,
    version: mapVersion(versionRow),
    courses,
    requirements,
    exceptions,
    careerTracks,
    summary: createSummary(department, courses, requirements, exceptions, careerTracks),
  };

  return preview;
}

export async function getDraftCurriculumSummaryByDepartment(
  departmentInput: string,
): Promise<CurriculumSummaryResult> {
  const result = await getDraftCurriculumByDepartment(departmentInput);

  if (result.kind !== "preview") {
    return result;
  }

  return {
    kind: "summary",
    department: result.department,
    version: result.version,
    summary: result.summary,
  };
}
