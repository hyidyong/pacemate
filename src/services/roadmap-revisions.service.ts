import { roadmapCourses, type RoadmapCourse } from "@/data/roadmap-explorer";
// Stage 9: the `demo anon ...` policies this module relied on are gone
// (20260814010000). Reads and writes now go through the caller's own
// session, so RLS enforces ownership and tenancy instead of the anon role.
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type RoadmapRevisionRequest = {
  id: string;
  scope: "course" | "department";
  status: "pending" | "assistant_reviewed" | "approved" | "rejected";
  course_code: string | null;
  course_id: string | null;
  department_name: string | null;
  title: string;
  summary: string;
  proposed_by_name: string;
  reviewed_by_name: string | null;
  approved_by_name: string | null;
  source_title: string | null;
  source_url: string | null;
  proposed_patch: Partial<RoadmapCourse>;
  admin_note: string | null;
  created_at: string;
  reviewed_at: string | null;
  approved_at: string | null;
  rejected_at: string | null;
};

const editableArrayFields = [
  "basics",
  "generalStudyMethod",
  "courseStudyMethod",
  "weeklyFocus",
] as const;

export async function getRoadmapRevisionRequests(
  statuses?: RoadmapRevisionRequest["status"][],
): Promise<RoadmapRevisionRequest[]> {
  const client = await createSupabaseServerClient();
  let query = client
    .from("roadmap_revision_requests")
    .select(
      "id, scope, status, course_code, course_id, department_name, title, summary, proposed_by_name, reviewed_by_name, approved_by_name, source_title, source_url, proposed_patch, admin_note, created_at, reviewed_at, approved_at, rejected_at",
    )
    .order("created_at", { ascending: false });

  if (statuses?.length) {
    query = query.in("status", statuses);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to load roadmap revision requests: ${error.message}`);
  }

  return (data ?? []) as unknown as RoadmapRevisionRequest[];
}

export async function getApprovedRoadmapCourses(): Promise<RoadmapCourse[]> {
  const revisions = await getRoadmapRevisionRequests(["approved"]);
  return applyApprovedRoadmapRevisions(roadmapCourses, revisions);
}

export function applyApprovedRoadmapRevisions(
  courses: RoadmapCourse[],
  revisions: RoadmapRevisionRequest[],
): RoadmapCourse[] {
  const latestByCourse = new Map<string, RoadmapRevisionRequest>();

  for (const revision of revisions) {
    const key = revision.course_id ?? courses.find((course) => course.code === revision.course_code)?.id;

    if (!key) {
      continue;
    }

    const current = latestByCourse.get(key);
    if (!current || (revision.approved_at ?? "") > (current.approved_at ?? "")) {
      latestByCourse.set(key, revision);
    }
  }

  return courses.map((course) => {
    const revision = latestByCourse.get(course.id);

    if (!revision) {
      return course;
    }

    const patch = sanitizeRoadmapPatch(revision.proposed_patch);
    return {
      ...course,
      ...patch,
      shortReason: patch.shortReason
        ? `${patch.shortReason} · 교수 검수 반영`
        : `${course.shortReason} · 교수 검수 반영`,
    };
  });
}

export function sanitizeRoadmapPatch(
  patch: Partial<RoadmapCourse> | null | undefined,
): Partial<RoadmapCourse> {
  if (!patch || typeof patch !== "object") {
    return {};
  }

  const result: Partial<RoadmapCourse> = {};

  if (typeof patch.shortReason === "string" && patch.shortReason.trim()) {
    result.shortReason = patch.shortReason.trim();
  }

  for (const field of editableArrayFields) {
    const value = patch[field];
    if (Array.isArray(value)) {
      result[field] = value
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .map((item) => item.trim());
    }
  }

  return result;
}

export function textareaToList(value: string) {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}
