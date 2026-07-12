import { supabase } from "@/lib/supabase/client";
import {
  STUDENT_BOOKING_END_HOUR,
  isWeekday,
  localDateKey,
  withHour,
} from "@/lib/scheduling-policy";
import type { DemoProfile } from "@/services/session.service";

export type CounselingProfessor = {
  id: string;
  name: string;
  office: string | null;
  email: string | null;
  departmentName?: string | null;
  bio?: string | null;
};

export type CounselingSlot = {
  professorId: string;
  professorName: string;
  professorOffice: string | null;
  professorEmail: string | null;
  start: string;
  end: string;
};

export function getCounselingSlotId(
  slot: Pick<CounselingSlot, "professorId" | "start" | "end">,
) {
  return JSON.stringify([slot.professorId, slot.start, slot.end]);
}

export type CounselingCourseOption = {
  id: string;
  code: string;
  name: string;
  category: string | null;
  professors: CounselingProfessor[];
};

export type StudentCounselingRequest = {
  id: string;
  professor_id: string;
  requested_start: string;
  requested_end: string;
  topic: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  professor_note: string | null;
  suggested_start: string | null;
  suggested_end: string | null;
  location: string | null;
  professor: { id: string; name: string; office: string | null } | null;
};

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

export type CounselingPageData = {
  profile: DemoProfile | null;
  requests: StudentCounselingRequest[];
  availableSlots: CounselingSlot[];
  courses: CounselingCourseOption[];
  professors: CounselingProfessor[];
};

export async function getCounselingPageData(
  profile: DemoProfile | null,
): Promise<CounselingPageData> {
  const [requests, availability, teachingSlots, busyRequests, adminTasks] = await Promise.all([
    getStudentRequests(profile),
    getAvailabilityRows(),
    getTeachingSlots(),
    getBusyRequests(),
    getAdminTasksRows(),
  ]);
  const [courses, professors] = await Promise.all([
    getCounselingCourses(profile),
    getCounselingProfessors(),
  ]);

  return {
    profile,
    requests,
    availableSlots: buildAvailableSlots(availability, teachingSlots, busyRequests, adminTasks),
    courses,
    professors,
  };
}

async function getStudentRequests(
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
    throw new Error(`Failed to load counseling requests: ${error.message}`);
  }

  return (data ?? []) as unknown as StudentCounselingRequest[];
}

async function getAvailabilityRows(): Promise<AvailabilityRow[]> {
  const { data, error } = await supabase
    .from("professor_availability")
    .select("professor_id, day_of_week, specific_date, start_time, end_time, slot_minutes, is_active, professor:professors(id, name, office, email)")
    .order("day_of_week", { ascending: true })
    .order("start_time", { ascending: true });

  if (error) {
    throw new Error(`Failed to load counseling availability: ${error.message}`);
  }

  return (data ?? []) as unknown as AvailabilityRow[];
}

async function getCounselingCourses(profile: DemoProfile | null): Promise<CounselingCourseOption[]> {
  const courseIds = await getStudentCourseIds(profile);
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
    throw new Error(`Failed to load counseling courses: ${error.message}`);
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

async function getStudentCourseIds(profile: DemoProfile | null) {
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

async function getCounselingProfessors(): Promise<CounselingProfessor[]> {
  const { data, error } = await supabase
    .from("professors")
    .select("id, name, office, email, bio, department:departments(name)")
    .order("name", { ascending: true });

  if (error) {
    throw new Error(`Failed to load professors: ${error.message}`);
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

async function getTeachingSlots(): Promise<TeachingSlotRow[]> {
  const { data, error } = await supabase
    .from("professor_teaching_slots")
    .select("professor_id, day_of_week, start_time, end_time");

  if (error) {
    throw new Error(`Failed to load teaching slots: ${error.message}`);
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

async function getAdminTasksRows(): Promise<AdminTaskRow[]> {
  const { data, error } = await supabase
    .from("professor_admin_tasks")
    .select("professor_id, title, day_of_week, start_time, end_time");

  if (error) {
    return [];
  }

  return (data ?? []) as AdminTaskRow[];
}

async function getBusyRequests(): Promise<BusyRequestRow[]> {
  const { data, error } = await supabase
    .from("counseling_requests")
    .select("professor_id, requested_start, requested_end")
    .in("status", ["pending", "approved"]);

  if (error) {
    throw new Error(`Failed to load busy counseling requests: ${error.message}`);
  }

  return (data ?? []) as BusyRequestRow[];
}

function buildAvailableSlots(
  availability: AvailabilityRow[],
  teachingSlots: TeachingSlotRow[],
  busyRequests: BusyRequestRow[],
  adminTasks: AdminTaskRow[],
) {
  const now = new Date();
  const slots: CounselingSlot[] = [];

  const activeAvailabilities = availability.filter(a => a.is_active);
  const blackoutAvailabilities = availability.filter(a => !a.is_active);

  for (const item of activeAvailabilities) {
    if (!item.professor) {
      continue;
    }

    for (let offset = 1; offset <= 14; offset += 1) {
      const date = new Date(now);
      date.setDate(now.getDate() + offset);

      if (!isWeekday(date) || !availabilityMatchesDate(item, date)) {
        continue;
      }

      for (const slot of splitAvailability(date, item)) {
        const hasTeachingConflict = teachingSlots.some(
          (teaching) =>
            teaching.professor_id === item.professor_id &&
            teaching.day_of_week === date.getDay() &&
            overlapsTimeOnly(slot.start, slot.end, teaching.start_time, teaching.end_time),
        );
        const hasAdminConflict = adminTasks.some(
          (admin) => {
            if (admin.professor_id !== item.professor_id) return false;
            
            // Check if it's a specific date blackout
            if (admin.title.startsWith("__BLACKOUT__")) {
               const blackoutDate = admin.title.split("__")[2]; // "2026-07-15"
               const localDateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
               if (localDateStr !== blackoutDate) {
                   return false; // not this specific date
               }
            } else {
               // recurring admin task, just check day
               if (admin.day_of_week !== date.getDay()) return false;
            }
            return overlapsTimeOnly(slot.start, slot.end, admin.start_time, admin.end_time);
          }
        );
        const hasRequestConflict = busyRequests.some(
          (request) =>
            request.professor_id === item.professor_id &&
            overlaps(slot.start, slot.end, new Date(request.requested_start), new Date(request.requested_end)),
        );
        const hasBlackoutConflict = blackoutAvailabilities.some(
          (blackout) => {
            if (blackout.professor_id !== item.professor_id) return false;
            if (!availabilityMatchesDate(blackout, date)) return false;
            return overlapsTimeOnly(slot.start, slot.end, blackout.start_time, blackout.end_time);
          }
        );

        if (!hasTeachingConflict && !hasAdminConflict && !hasRequestConflict && !hasBlackoutConflict) {
          slots.push({
            professorId: item.professor_id,
            professorName: item.professor.name,
            professorOffice: item.professor.office,
            professorEmail: item.professor.email,
            start: slot.start.toISOString(),
            end: slot.end.toISOString(),
          });
        }
      }
    }
  }

  const uniqueSlots = new Map<string, CounselingSlot>();
  for (const slot of slots) {
    uniqueSlots.set(getCounselingSlotId(slot), slot);
  }

  return Array.from(uniqueSlots.values())
    .sort((a, b) => a.start.localeCompare(b.start))
    .slice(0, 48); // Increase slots limit for better demo experience
}

function splitAvailability(date: Date, item: AvailabilityRow) {
  const start = withTime(date, item.start_time);
  const availabilityEnd = withTime(date, item.end_time);
  const bookingEnd = withHour(date, STUDENT_BOOKING_END_HOUR);
  const end = availabilityEnd < bookingEnd ? availabilityEnd : bookingEnd;
  const slots: Array<{ start: Date; end: Date }> = [];
  const cursor = new Date(start);

  if (cursor >= bookingEnd || end <= cursor) {
    return slots;
  }

  while (cursor < end) {
    const slotEnd = new Date(cursor);
    slotEnd.setMinutes(slotEnd.getMinutes() + item.slot_minutes);

    if (slotEnd <= end) {
      slots.push({ start: new Date(cursor), end: slotEnd });
    }

    cursor.setMinutes(cursor.getMinutes() + item.slot_minutes);
  }

  return slots;
}

function availabilityMatchesDate(item: AvailabilityRow, date: Date) {
  if (item.specific_date) {
    return item.specific_date === localDateKey(date);
  }

  return item.day_of_week === date.getDay();
}

function withTime(date: Date, time: string) {
  const [hour = "0", minute = "0"] = time.split(":");
  const next = new Date(date);
  next.setHours(Number(hour), Number(minute), 0, 0);
  return next;
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && bStart < aEnd;
}

function overlapsTimeOnly(start: Date, end: Date, busyStart: string, busyEnd: string) {
  const busyStartDate = withTime(start, busyStart);
  const busyEndDate = withTime(start, busyEnd);
  return overlaps(start, end, busyStartDate, busyEndDate);
}
