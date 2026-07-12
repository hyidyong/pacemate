export type CompanyLawOfferingRow = {
  id: string;
  course: { name: string } | { name: string }[] | null;
  academic_term: { semester_label: string } | { semester_label: string }[] | null;
};

type CompanyLawOfferingSelection =
  | {
      ok: true;
      offeringId: string;
      courseName: string;
      semesterLabel: string;
    }
  | { ok: false; code: "offering_not_found" | "database_read_failed" };

function firstRelatedRow<T>(relation: T | T[] | null): T | null {
  return Array.isArray(relation) ? relation[0] ?? null : relation;
}

export function selectCompanyLawOffering(
  assignedOfferingIds: string[],
  offerings: CompanyLawOfferingRow[],
): CompanyLawOfferingSelection {
  const assignedIds = new Set(assignedOfferingIds);
  const matches = offerings.filter((offering) => {
    const course = firstRelatedRow(offering.course);
    const term = firstRelatedRow(offering.academic_term);
    return (
      assignedIds.has(offering.id) &&
      course?.name === "회사법" &&
      term?.semester_label === "2026-2"
    );
  });

  if (matches.length === 0) return { ok: false, code: "offering_not_found" };
  if (matches.length > 1) return { ok: false, code: "database_read_failed" };

  const match = matches[0];
  const course = firstRelatedRow(match.course);
  const term = firstRelatedRow(match.academic_term);
  if (!course || !term) return { ok: false, code: "database_read_failed" };

  return {
    ok: true,
    offeringId: match.id,
    courseName: course.name,
    semesterLabel: term.semester_label,
  };
}
