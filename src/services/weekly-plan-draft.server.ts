import "server-only";

import companyLawDraft from "@/data/weekly-plans/2026-2-company-law.draft.json";
import administrativeProcedureDraft from "@/data/weekly-plans/2026-2-administrative-procedure-remedies.draft.json";
import securedTransactionsDraft from "@/data/weekly-plans/2026-2-secured-transactions-law.draft.json";
import type {
  WeeklyPlanActivityType,
  WeeklyPlanConfidence,
  WeeklyPlanDraft,
  WeeklyPlanStatus,
  WeeklyPlanValidationResult,
} from "@/types/weekly-roadmap";

const allowedStatuses: readonly WeeklyPlanStatus[] = ["draft", "approved"];
const allowedConfidences: readonly WeeklyPlanConfidence[] = ["high", "medium", "low"];
const allowedActivityTypes: readonly WeeklyPlanActivityType[] = [
  "lecture",
  "review",
  "discussion",
  "assignment",
  "assessment",
];

const draftInputs: readonly unknown[] = [
  companyLawDraft,
  administrativeProcedureDraft,
  securedTransactionsDraft,
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function hasEnumValue<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && values.includes(value as T);
}

export function validateWeeklyPlanDraft(input: unknown): WeeklyPlanValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isRecord(input)) return { valid: false, errors: ["draft must be an object"], warnings };

  if (!hasEnumValue(allowedStatuses, input.status)) errors.push("status must be draft or approved");
  for (const field of ["termId", "offeringId", "courseId", "courseName", "professorId", "professorName", "semesterLabel"]) {
    if (!isNonEmptyString(input[field])) errors.push(`${field} must be a non-empty string`);
  }

  const source = input.source;
  if (!isRecord(source) || source.type !== "syllabus" || !isNonEmptyString(source.syllabusId) || typeof source.verifiedByProfessor !== "boolean") {
    errors.push("source must contain type, syllabusId, and verifiedByProfessor");
  }

  if (!Array.isArray(input.weeks) || input.weeks.length !== 15) {
    errors.push("weeks must contain exactly 15 items");
  } else {
    input.weeks.forEach((week, index) => {
      if (!isRecord(week)) {
        errors.push(`weeks[${index}] must be an object`);
        return;
      }
      if (week.weekNumber !== index + 1) errors.push(`weeks[${index}].weekNumber must be ${index + 1}`);
      if (!isNonEmptyString(week.title)) errors.push(`weeks[${index}].title must be a non-empty string`);
      if (!isStringArray(week.topics)) errors.push(`weeks[${index}].topics must be an array of strings`);
      if (!hasEnumValue(allowedActivityTypes, week.activityType)) errors.push(`weeks[${index}].activityType is invalid`);
      if (typeof week.isAssessment !== "boolean") errors.push(`weeks[${index}].isAssessment must be boolean`);
      if (!hasEnumValue(allowedConfidences, week.confidence)) errors.push(`weeks[${index}].confidence is invalid`);
      if (!isNonEmptyString(week.sourceNote)) errors.push(`weeks[${index}].sourceNote must be a non-empty string`);
    });
  }

  if (!Array.isArray(input.warnings) || !input.warnings.every((warning) => typeof warning === "string")) {
    errors.push("warnings must be an array of strings");
  } else {
    warnings.push(...input.warnings);
  }

  if (input.status === "draft" && isRecord(source) && source.verifiedByProfessor === true) {
    errors.push("draft cannot be marked verifiedByProfessor");
  }

  return { valid: errors.length === 0, errors, warnings };
}

function readDraft(input: unknown): WeeklyPlanDraft {
  const validation = validateWeeklyPlanDraft(input);
  if (!validation.valid) throw new Error(`Invalid weekly plan draft: ${validation.errors.join("; ")}`);
  return input as WeeklyPlanDraft;
}

function loadDrafts(): WeeklyPlanDraft[] {
  return draftInputs.map(readDraft);
}

export function getWeeklyPlanDraftByOfferingId(offeringId: string): WeeklyPlanDraft | null {
  if (!isNonEmptyString(offeringId)) return null;
  return loadDrafts().find((draft) => draft.offeringId === offeringId) ?? null;
}

export function getWeeklyPlanDraftByCourseId(courseId: string): WeeklyPlanDraft | null {
  if (!isNonEmptyString(courseId)) return null;
  return loadDrafts().find((draft) => draft.courseId === courseId) ?? null;
}

export function getWeeklyPlanDraftByIdentity(input: {
  courseId: string;
  professorId: string;
  termId: string;
}): WeeklyPlanDraft | null {
  if (!isNonEmptyString(input.courseId) || !isNonEmptyString(input.professorId) || !isNonEmptyString(input.termId)) {
    return null;
  }

  return loadDrafts().find(
    (draft) =>
      draft.courseId === input.courseId &&
      draft.professorId === input.professorId &&
      draft.termId === input.termId,
  ) ?? null;
}

export function listWeeklyPlanDrafts(): WeeklyPlanDraft[] {
  return loadDrafts().map((draft) => ({
    ...draft,
    source: { ...draft.source },
    weeks: draft.weeks.map((week) => ({ ...week, topics: [...week.topics] })),
    warnings: [...draft.warnings],
  }));
}
