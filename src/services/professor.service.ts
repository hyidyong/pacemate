// professor_availability/faqs rows must stay readable in every state
// (inactive slots, unapproved answers), which only the demo anon policies
// currently allow; counseling request reads need the service role because the
// authenticated role can no longer read student names after the profile
// column-grant hardening migrations.
import { supabase as anonSupabase } from "@/lib/supabase/client";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { RoadmapRevisionRequest } from "@/services/roadmap-revisions.service";
import type { DemoProfile } from "@/services/session.service";
import { normalizeProfessorCounselingRows } from "@/services/professor-counseling-data";

export type ProfessorCourse = {
  id: string;
  code: string;
  name: string;
  credit: number;
  category: string | null;
};

export type ProfessorProfile = {
  id: string;
  name: string;
  office: string | null;
  email: string | null;
  bio: string | null;
  department: { name: string }[];
};

export type ProfessorAvailability = {
  id: string;
  professor_id: string;
  day_of_week: number | null;
  specific_date: string | null;
  start_time: string;
  end_time: string;
  slot_minutes: number;
  is_active: boolean;
};

export type ProfessorAdminTaskRecord = {
  id: string;
  title: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
};

export type ProfessorFaq = {
  id: string;
  question: string;
  answer: string;
  category: string | null;
  approved_at: string | null;
  course: { id: string; name: string } | null;
};

export type ProfessorCounselingRequest = {
  id: string;
  student_id: string;
  requested_start: string;
  requested_end: string;
  topic: string;
  location: string | null;
  status: "pending" | "approved" | "rejected" | "cancelled" | "answered" | "ANSWERED" | "PENDING";
  professor_note: string | null;
  suggested_start: string | null;
  suggested_end: string | null;
  student?: { name: string; identifier: string; major?: string };
};

export type ProfessorTeachingSlot = {
  id: string;
  day_of_week: number;
  period_label: string;
  start_time: string;
  end_time: string;
  classroom: string | null;
  course_type: string | null;
  target_label: string | null;
  course: { id: string; code: string; name: string } | null;
};

export type ProfessorPageData = {
  profile: DemoProfile | null;
  professor: ProfessorProfile | null;
  courses: ProfessorCourse[];
  teachingSlots: ProfessorTeachingSlot[];
  availability: ProfessorAvailability[];
  adminTasks: ProfessorAdminTaskRecord[];
  faqs: ProfessorFaq[];
  counselingRequests: ProfessorCounselingRequest[];
  calendarRequests: ProfessorCounselingRequest[];
  roadmapRequests: RoadmapRevisionRequest[];
};

export async function getProfessorPageData(
  profile: DemoProfile | null,
): Promise<ProfessorPageData> {
  const professor = await getCurrentProfessor(profile);

  if (!professor) {
    return {
      profile,
      professor: null,
      courses: [],
      teachingSlots: [],
      availability: [],
      adminTasks: [],
      faqs: [],
      counselingRequests: [],
      calendarRequests: [],
      roadmapRequests: [],
    };
  }

  const [
    courses,
    teachingSlots,
    availability,
    adminTasks,
    faqs,
    counselingRequests,
    calendarRequests,
    roadmapRequests,
  ] =
    await Promise.all([
      getProfessorCourses(professor.id),
      getTeachingSlots(professor.id),
      getAvailability(professor.id),
      getAdminTasks(professor.id),
      getFaqs(professor.id),
      getCounselingRequests(professor.id),
      getCalendarRequests(professor.id),
      getRoadmapRequests(),
    ]);

  return {
    profile,
    professor,
    courses,
    teachingSlots,
    availability,
    adminTasks,
    faqs,
    counselingRequests,
    calendarRequests,
    roadmapRequests,
  };
}

export async function getProfessorProfile(profile: DemoProfile | null): Promise<ProfessorProfile | null> {
  if (profile?.role !== "professor") {
    return null;
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("professors")
    .select("id, name, office, email, bio, department:departments(name)")
    .eq("profile_id", profile.id)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load professor profile: ${error.message}`);
  }

  return data as ProfessorProfile | null;
}

async function getCurrentProfessor(profile: DemoProfile | null) {
  const supabase = await createSupabaseServerClient();
  if (profile?.role === "professor") {
    const { data } = await supabase
      .from("professors")
      .select("id, name, office, email, bio, department:departments(name)")
      .eq("profile_id", profile.id)
      .maybeSingle();

    if (data) {
      return data;
    }
  }

  const { data } = await supabase
    .from("professors")
    .select("id, name, office, email, bio, department:departments(name)")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  return data;
}

async function getProfessorCourses(professorId: string): Promise<ProfessorCourse[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("course_professors")
    .select("course:courses(id, code, name, credit, category)")
    .eq("professor_id", professorId);

  if (error) {
    throw new Error(`Failed to load professor courses: ${error.message}`);
  }

  return ((data ?? []).map((item) => item.course).filter(Boolean) ??
    []) as unknown as ProfessorCourse[];
}

async function getTeachingSlots(
  professorId: string,
): Promise<ProfessorTeachingSlot[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("professor_teaching_slots")
    .select(
      "id, day_of_week, period_label, start_time, end_time, classroom, course_type, target_label, course:courses(id, code, name)",
    )
    .eq("professor_id", professorId)
    .order("day_of_week", { ascending: true })
    .order("start_time", { ascending: true });

  if (error) {
    throw new Error(`Failed to load teaching slots: ${error.message}`);
  }

  return (data ?? []) as unknown as ProfessorTeachingSlot[];
}

async function getAvailability(
  professorId: string,
): Promise<ProfessorAvailability[]> {
  const { data, error } = await anonSupabase
    .from("professor_availability")
    .select("id, professor_id, day_of_week, specific_date, start_time, end_time, slot_minutes, is_active")
    .eq("professor_id", professorId)
    .order("day_of_week", { ascending: true })
    .order("start_time", { ascending: true });

  if (error) {
    throw new Error(`Failed to load availability: ${error.message}`);
  }

  return (data ?? []) as ProfessorAvailability[];
}

async function getAdminTasks(
  professorId: string,
): Promise<ProfessorAdminTaskRecord[]> {
  const serverSupabase = await createSupabaseServerClient();
  const { data, error } = await serverSupabase
    .from("professor_admin_tasks")
    .select("id, title, day_of_week, start_time, end_time")
    .eq("professor_id", professorId)
    .order("day_of_week", { ascending: true })
    .order("start_time", { ascending: true });

  if (error) {
    // If the table is not created yet, return empty gracefully.
    return [];
  }

  return (data ?? []) as ProfessorAdminTaskRecord[];
}

async function getFaqs(professorId: string): Promise<ProfessorFaq[]> {
  const { data, error } = await anonSupabase
    .from("faqs")
    .select("id, question, answer, category, approved_at, course:courses(id, name)")
    .eq("professor_id", professorId)
    .order("created_at", { ascending: false })
    .limit(10);

  if (error) {
    throw new Error(`Failed to load professor FAQ: ${error.message}`);
  }

  return (data ?? []) as unknown as ProfessorFaq[];
}

async function getCounselingRequests(
  professorId: string,
): Promise<ProfessorCounselingRequest[]> {
  // Service role: the professor page has already resolved the professor from
  // the signed session, and the query is scoped to that professor_id.
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("counseling_requests")
    .select("id, student_id, requested_start, requested_end, topic, status, professor_note, location, suggested_start, suggested_end, student:profiles(name, identifier)")
    .eq("professor_id", professorId)
    .order("requested_start", { ascending: true })
    .limit(12);

  if (error) {
    console.error(error);
  }

  const result = (data ?? []) as any[];

  return normalizeProfessorCounselingRows(
    result as unknown as ProfessorCounselingRequest[],
  );
}

async function getCalendarRequests(
  professorId: string,
): Promise<ProfessorCounselingRequest[]> {
  // The calendar's busy computation needs EVERY pending/approved request for
  // this professor — the management list above keeps its own narrower query.
  // Same service-role rationale as getCounselingRequests.
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("counseling_requests")
    .select("id, student_id, requested_start, requested_end, topic, status, professor_note, location, suggested_start, suggested_end, student:profiles(name, identifier)")
    .eq("professor_id", professorId)
    .in("status", ["pending", "approved"])
    .order("requested_start", { ascending: true });

  if (error) {
    console.error(error);
  }

  return normalizeProfessorCounselingRows(
    (data ?? []) as unknown as ProfessorCounselingRequest[],
  );
}

async function getRoadmapRequests(): Promise<RoadmapRevisionRequest[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("roadmap_revision_requests")
    .select(
      "id, scope, status, course_code, course_id, department_name, title, summary, proposed_by_name, reviewed_by_name, approved_by_name, source_title, source_url, proposed_patch, admin_note, created_at, reviewed_at, approved_at, rejected_at",
    )
    .order("created_at", { ascending: false })
    .limit(8);

  if (error) {
    throw new Error(`Failed to load roadmap requests: ${error.message}`);
  }

  return (data ?? []) as unknown as RoadmapRevisionRequest[];
}
