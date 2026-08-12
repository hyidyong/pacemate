import "server-only";

import {
  COUNSELING_SLOT_HORIZON_DAYS,
  PACEMATE_TIME_ZONE,
  buildAvailableCounselingSlots,
} from "@/lib/counseling-slots";
import { tryResolveTenantContext } from "@/lib/tenant";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { DemoProfile } from "@/services/session.service";
import type {
  CounselingCourseOption,
  CounselingPageData,
  CounselingProfessor,
  StudentCounselingRequest,
} from "@/types/counseling";

const DAY_IN_MS = 24 * 60 * 60 * 1000;

type AvailabilityRow = {
  professor_id: string;
  day_of_week: number | null;
  specific_date: string | null;
  start_time: string;
  end_time: string;
  slot_minutes: number;
  is_active: boolean;
  professor: CounselingProfessor | null;
};

type TeachingSlotRow = {
  professor_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
};

type BusyRequestRow = {
  professor_id: string;
  requested_start: string;
  requested_end: string;
};

export async function getCounselingPageData(
  profile: DemoProfile | null,
): Promise<CounselingPageData> {
  // Stage 6: everything a student sees is scoped to their own tenant. A
  // session with no resolvable tenant renders the empty view rather than the
  // whole platform's professors/slots.
  const tenant = tryResolveTenantContext(profile);
  if (!profile || !tenant) {
    return { requests: [], availableSlots: [], courses: [], professors: [] };
  }
  const tenantId = tenant.tenantId;

  const supabase = await createSupabaseServerClient();
  const adminSupabase = createSupabaseAdminClient();
  // One batch: courses/professors consume nothing from the availability set, so
  // splitting them into a second await only added a full WAN stage. The real
  // dependency (student_courses -> course_professors) lives inside
  // getCounselingCourses.
  const [requests, availability, teachingSlots, busyRequests, adminTasks, courses, professors] =
    await Promise.all([
      getStudentRequests(supabase, profile),
      getAvailabilityRows(supabase, tenantId),
      getTeachingSlots(supabase, tenantId),
      getBusyRequests(adminSupabase),
      getAdminTasksRows(supabase, tenantId),
      getCounselingCourses(supabase, profile, tenantId),
      getCounselingProfessors(supabase, tenantId),
    ]);

  return {
    requests,
    availableSlots: buildSlots(availability, teachingSlots, busyRequests, adminTasks),
    courses,
    professors,
  };
}

export async function getAvailableCounselingSlots(tenantId: string) {
  const supabase = await createSupabaseServerClient();
  const adminSupabase = createSupabaseAdminClient();
  const [availability, teachingSlots, busyRequests, adminTasks] = await Promise.all([
    getAvailabilityRows(supabase, tenantId),
    getTeachingSlots(supabase, tenantId),
    getBusyRequests(adminSupabase),
    getAdminTasksRows(supabase, tenantId),
  ]);

  return buildSlots(availability, teachingSlots, busyRequests, adminTasks);
}

type ServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

async function getStudentRequests(
  supabase: ServerClient,
  profile: DemoProfile | null,
): Promise<StudentCounselingRequest[]> {
  if (!profile) {
    return [];
  }

  const { data, error } = await supabase
    .from("counseling_requests")
    .select(
      "id, professor_id, requested_start, requested_end, topic, status, professor_note, location, suggested_start, suggested_end, professor:professors(id, name, office)",
    )
    .eq("student_id", profile.id)
    .order("created_at", { ascending: false })
    .limit(12);

  if (error) {
    throw new Error("Failed to load counseling requests");
  }

  return (data ?? []) as unknown as StudentCounselingRequest[];
}

async function getAvailabilityRows(
  supabase: ServerClient,
  tenantId: string,
): Promise<AvailabilityRow[]> {
  // !inner + the embedded school_id filter scopes availability to the tenant's
  // professors at the DB boundary — a foreign professor's window never reaches
  // the slot builder, so it can never be rendered or booked.
  const { data, error } = await supabase
    .from("professor_availability")
    .select("professor_id, day_of_week, specific_date, start_time, end_time, slot_minutes, is_active, professor:professors!inner(id, name, office, email, school_id)")
    .eq("professor.school_id", tenantId)
    .order("day_of_week", { ascending: true })
    .order("start_time", { ascending: true });

  if (error) {
    throw new Error("Failed to load counseling availability");
  }

  return (data ?? []) as unknown as AvailabilityRow[];
}

async function getCounselingCourses(
  supabase: ServerClient,
  profile: DemoProfile | null,
  tenantId: string,
): Promise<CounselingCourseOption[]> {
  const courseIds = await getStudentCourseIds(supabase, profile);
  // Scope to the tenant's courses. Without this, the empty-course-list
  // fallthrough (no .in filter) would return every course_professors row on
  // the platform (AUDIT X3).
  let query = supabase
    .from("course_professors")
    .select(
      "course:courses!inner(id, code, name, category, school_id), professor:professors(id, name, office, email, bio, department:departments(name))",
    )
    .eq("course.school_id", tenantId)
    .order("semester_label", { ascending: false });

  if (courseIds.length) {
    query = query.in("course_id", courseIds);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error("Failed to load counseling courses");
  }

  const byCourse = new Map<string, CounselingCourseOption>();

  for (const row of (data ?? []) as unknown as Array<{
    course: { id: string; code: string; name: string; category: string | null } | null;
    professor: (CounselingProfessor & { department?: { name: string } | null }) | null;
  }>) {
    if (!row.course || !row.professor) {
      continue;
    }

    const current =
      byCourse.get(row.course.id) ??
      {
        id: row.course.id,
        code: row.course.code,
        name: row.course.name,
        category: row.course.category,
        professors: [],
      };

    current.professors.push({
      id: row.professor.id,
      name: row.professor.name,
      office: row.professor.office,
      email: row.professor.email,
      bio: row.professor.bio,
      departmentName: row.professor.department?.name ?? null,
    });
    byCourse.set(row.course.id, current);
  }

  return Array.from(byCourse.values()).sort((a, b) => a.name.localeCompare(b.name));
}

async function getStudentCourseIds(supabase: ServerClient, profile: DemoProfile | null) {
  if (!profile) {
    return [];
  }

  const { data, error } = await supabase
    .from("student_courses")
    .select("course_id")
    .eq("student_id", profile.id)
    .in("status", ["interested", "recommended"]);

  if (error || !data?.length) {
    return [];
  }

  return data.map((item) => item.course_id as string);
}

async function getCounselingProfessors(
  supabase: ServerClient,
  tenantId: string,
): Promise<CounselingProfessor[]> {
  // The professor directory is a searchable, bookable list rendered to the
  // student — scope it to the tenant (AUDIT X2). professors.school_id is a
  // real column (Stage 6 M2), so this is a direct filter.
  const { data, error } = await supabase
    .from("professors")
    .select("id, name, office, email, bio, department:departments(name)")
    .eq("school_id", tenantId)
    .order("name", { ascending: true });

  if (error) {
    throw new Error("Failed to load professors");
  }

  return ((data ?? []) as unknown as Array<CounselingProfessor & { department?: { name: string } | null }>).map(
    (professor) => ({
      id: professor.id,
      name: professor.name,
      office: professor.office,
      email: professor.email,
      bio: professor.bio,
      departmentName: professor.department?.name ?? null,
    }),
  );
}

async function getTeachingSlots(
  supabase: ServerClient,
  tenantId: string,
): Promise<TeachingSlotRow[]> {
  // Teaching slots feed the same slot builder; scope to the tenant's
  // professors via the embedded !inner filter (the professor field is used
  // only for filtering, not output).
  const { data, error } = await supabase
    .from("professor_teaching_slots")
    .select("professor_id, day_of_week, start_time, end_time, professor:professors!inner(school_id)")
    .eq("professor.school_id", tenantId);

  if (error) {
    throw new Error("Failed to load teaching slots");
  }

  return (data ?? []) as unknown as TeachingSlotRow[];
}

type AdminTaskRow = {
  professor_id: string;
  title: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
};

async function getAdminTasksRows(
  supabase: ServerClient,
  tenantId: string,
): Promise<AdminTaskRow[]> {
  const { data, error } = await supabase
    .from("professor_admin_tasks")
    .select("professor_id, title, day_of_week, start_time, end_time, professor:professors!inner(school_id)")
    .eq("professor.school_id", tenantId);

  if (error) {
    throw new Error("Failed to load professor admin tasks");
  }

  return (data ?? []) as unknown as AdminTaskRow[];
}

// The busy feed is the canonical "these ranges are consumed" input (D-005) for
// both the displayed availability and the booking revalidation. It must see
// EVERY student's pending/approved rows, but the session client is RLS-scoped
// to the caller's own rows — which silently blinded availability to other
// students' reservations. Read it with the admin client (minimal columns, no
// student identifiers), the same authority the professor data path uses.
//
// Stage 6: this read is DELIBERATELY not tenant-filtered. The slot builder
// keys busy rows on professorId, and the availability set is already
// tenant-scoped, so a foreign tenant's busy rows never match a rendered slot
// (they are inert) and never reach the client. Adding a tenant filter here
// would be a pure perf/data-minimization change (Stage 8), and it would touch
// the Stage 5 concurrency invariant (D-011) that this read is authoritative —
// left intact. Isolation is enforced by the availability/professor scoping
// above, not by this feed.
// Stage 8 P1-1: bound the window. `approved` rows never leave the status, so an
// unbounded status-only filter grew with cumulative platform-wide bookings
// forever — on every /counseling render AND inside every booking action.
//
// The bound is derived, not guessed: the slot builder only considers local
// dates today+1..today+COUNSELING_SLOT_HORIZON_DAYS, so a booking whose range
// ended before now cannot overlap any bookable slot, and one starting past the
// horizon cannot either. Both are inert inputs; excluding them is
// behaviour-preserving by construction. A day of slack on each side absorbs any
// KST/UTC boundary skew between this query and the builder's own `now`.
//
// Deliberately still NOT filtered by professor or tenant: the feed must see
// EVERY student's rows (D-011) and the slot set is already tenant-scoped, so
// foreign rows are inert. Scoping to the caller would resurrect the pre-D-011
// blindness this read exists to fix.
async function getBusyRequests(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  now = new Date(),
): Promise<BusyRequestRow[]> {
  const windowStart = new Date(now.getTime() - DAY_IN_MS);
  const windowEnd = new Date(now.getTime() + (COUNSELING_SLOT_HORIZON_DAYS + 1) * DAY_IN_MS);

  const { data, error } = await supabase
    .from("counseling_requests")
    .select("professor_id, requested_start, requested_end")
    .in("status", ["pending", "approved"])
    .gte("requested_end", windowStart.toISOString())
    .lt("requested_start", windowEnd.toISOString());

  if (error) {
    throw new Error("Failed to load busy counseling requests");
  }

  return (data ?? []) as BusyRequestRow[];
}

function buildSlots(
  availability: AvailabilityRow[],
  teachingSlots: TeachingSlotRow[],
  busyRequests: BusyRequestRow[],
  adminTasks: AdminTaskRow[],
) {
  return buildAvailableCounselingSlots({
    now: new Date(),
    timeZone: PACEMATE_TIME_ZONE,
    availability: availability.flatMap((item) =>
      item.professor
        ? [{
            professorId: item.professor_id,
            professorName: item.professor.name,
            professorOffice: item.professor.office,
            professorEmail: item.professor.email,
            dayOfWeek: item.day_of_week,
            specificDate: item.specific_date,
            startTime: item.start_time,
            endTime: item.end_time,
            slotMinutes: item.slot_minutes,
            isActive: item.is_active,
          }]
        : [],
    ),
    teachingSlots: teachingSlots.map((item) => ({
      professorId: item.professor_id,
      dayOfWeek: item.day_of_week,
      startTime: item.start_time,
      endTime: item.end_time,
    })),
    busyRequests: busyRequests.map((item) => ({
      professorId: item.professor_id,
      start: item.requested_start,
      end: item.requested_end,
    })),
    adminTasks: adminTasks.map((item) => ({
      professorId: item.professor_id,
      title: item.title,
      dayOfWeek: item.day_of_week,
      startTime: item.start_time,
      endTime: item.end_time,
    })),
  });
}
