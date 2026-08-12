import "server-only";

import {
  PACEMATE_TIME_ZONE,
  buildAvailableCounselingSlots,
} from "@/lib/counseling-slots";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { DemoProfile } from "@/services/session.service";
import type {
  CounselingCourseOption,
  CounselingPageData,
  CounselingProfessor,
  StudentCounselingRequest,
} from "@/types/counseling";

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
  const supabase = await createSupabaseServerClient();
  const adminSupabase = createSupabaseAdminClient();
  // One batch: courses/professors consume nothing from the availability set, so
  // splitting them into a second await only added a full WAN stage. The real
  // dependency (student_courses -> course_professors) lives inside
  // getCounselingCourses.
  const [requests, availability, teachingSlots, busyRequests, adminTasks, courses, professors] =
    await Promise.all([
      getStudentRequests(supabase, profile),
      getAvailabilityRows(supabase),
      getTeachingSlots(supabase),
      getBusyRequests(adminSupabase),
      getAdminTasksRows(supabase),
      getCounselingCourses(supabase, profile),
      getCounselingProfessors(supabase),
    ]);

  return {
    requests,
    availableSlots: buildSlots(availability, teachingSlots, busyRequests, adminTasks),
    courses,
    professors,
  };
}

export async function getAvailableCounselingSlots() {
  const supabase = await createSupabaseServerClient();
  const adminSupabase = createSupabaseAdminClient();
  const [availability, teachingSlots, busyRequests, adminTasks] = await Promise.all([
    getAvailabilityRows(supabase),
    getTeachingSlots(supabase),
    getBusyRequests(adminSupabase),
    getAdminTasksRows(supabase),
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

async function getAvailabilityRows(supabase: ServerClient): Promise<AvailabilityRow[]> {
  const { data, error } = await supabase
    .from("professor_availability")
    .select("professor_id, day_of_week, specific_date, start_time, end_time, slot_minutes, is_active, professor:professors(id, name, office, email)")
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
): Promise<CounselingCourseOption[]> {
  const courseIds = await getStudentCourseIds(supabase, profile);
  let query = supabase
    .from("course_professors")
    .select(
      "course:courses(id, code, name, category), professor:professors(id, name, office, email, bio, department:departments(name))",
    )
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

async function getCounselingProfessors(supabase: ServerClient): Promise<CounselingProfessor[]> {
  const { data, error } = await supabase
    .from("professors")
    .select("id, name, office, email, bio, department:departments(name)")
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

async function getTeachingSlots(supabase: ServerClient): Promise<TeachingSlotRow[]> {
  const { data, error } = await supabase
    .from("professor_teaching_slots")
    .select("professor_id, day_of_week, start_time, end_time");

  if (error) {
    throw new Error("Failed to load teaching slots");
  }

  return (data ?? []) as TeachingSlotRow[];
}

type AdminTaskRow = {
  professor_id: string;
  title: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
};

async function getAdminTasksRows(supabase: ServerClient): Promise<AdminTaskRow[]> {
  const { data, error } = await supabase
    .from("professor_admin_tasks")
    .select("professor_id, title, day_of_week, start_time, end_time");

  if (error) {
    throw new Error("Failed to load professor admin tasks");
  }

  return (data ?? []) as AdminTaskRow[];
}

// The busy feed is the canonical "these ranges are consumed" input (D-005) for
// both the displayed availability and the booking revalidation. It must see
// EVERY student's pending/approved rows, but the session client is RLS-scoped
// to the caller's own rows — which silently blinded availability to other
// students' reservations. Read it with the admin client (minimal columns, no
// student identifiers), the same authority the professor data path uses.
async function getBusyRequests(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
): Promise<BusyRequestRow[]> {
  const { data, error } = await supabase
    .from("counseling_requests")
    .select("professor_id, requested_start, requested_end")
    .in("status", ["pending", "approved"]);

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
