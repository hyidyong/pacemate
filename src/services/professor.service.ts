import { supabase } from "@/lib/supabase/client";
import type { RoadmapRevisionRequest } from "@/services/roadmap-revisions.service";
import type { DemoProfile } from "@/services/session.service";

export type ProfessorCourse = {
  id: string;
  code: string;
  name: string;
  credit: number;
  category: string | null;
};

export type ProfessorAvailability = {
  id: string;
  professor_id: string;
  day_of_week: number;
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
  status: "pending" | "approved" | "rejected" | "cancelled";
  professor_note: string | null;
  suggested_start: string | null;
  suggested_end: string | null;
  location: string | null;
  student?: { name: string; identifier: string };
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
  professor: {
    id: string;
    name: string;
    office: string | null;
    email: string | null;
    bio: string | null;
  } | null;
  courses: ProfessorCourse[];
  teachingSlots: ProfessorTeachingSlot[];
  availability: ProfessorAvailability[];
  adminTasks: ProfessorAdminTaskRecord[];
  faqs: ProfessorFaq[];
  counselingRequests: ProfessorCounselingRequest[];
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
    roadmapRequests,
  ] =
    await Promise.all([
      getProfessorCourses(professor.id),
      getTeachingSlots(professor.id),
      getAvailability(professor.id),
      getAdminTasks(professor.id),
      getFaqs(professor.id),
      getCounselingRequests(professor.id),
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
    roadmapRequests,
  };
}

async function getCurrentProfessor(profile: DemoProfile | null) {
  if (profile?.role === "professor") {
    const { data } = await supabase
      .from("professors")
      .select("id, name, office, email, bio")
      .eq("profile_id", profile.id)
      .maybeSingle();

    if (data) {
      return data;
    }
  }

  const { data } = await supabase
    .from("professors")
    .select("id, name, office, email, bio")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  return data;
}

async function getProfessorCourses(professorId: string): Promise<ProfessorCourse[]> {
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
  const { data, error } = await supabase
    .from("professor_availability")
    .select("id, professor_id, day_of_week, start_time, end_time, slot_minutes, is_active")
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
  const { data, error } = await supabase
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
  const { data, error } = await supabase
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

  // 5명 이상 더미 학생 데이터 확충
  const today = new Date();
  const dateStr = (dayOffset: number) => {
    const d = new Date(today);
    d.setDate(today.getDate() + dayOffset);
    return d.toISOString().split("T")[0];
  };

  const dummyData: ProfessorCounselingRequest[] = [
    { id: "dummy-1", student_id: "s1", requested_start: `${dateStr(1)}T10:00:00Z`, requested_end: `${dateStr(1)}T10:30:00Z`, topic: "중간고사 성적 이의신청", status: "pending", professor_note: null, suggested_start: null, suggested_end: null, student: { name: "김민준", identifier: "20240101" } },
    { id: "dummy-2", student_id: "s2", requested_start: `${dateStr(2)}T14:00:00Z`, requested_end: `${dateStr(2)}T14:30:00Z`, topic: "진로 및 취업 상담", status: "pending", professor_note: null, suggested_start: null, suggested_end: null, student: { name: "이서연", identifier: "20230202" } },
    { id: "dummy-3", student_id: "s3", requested_start: `${dateStr(3)}T11:00:00Z`, requested_end: `${dateStr(3)}T11:30:00Z`, topic: "대학원 진학 문의", status: "approved", professor_note: null, suggested_start: null, suggested_end: null, student: { name: "박지훈", identifier: "20220303" } },
    { id: "dummy-4", student_id: "s4", requested_start: `${dateStr(4)}T15:00:00Z`, requested_end: `${dateStr(4)}T15:30:00Z`, topic: "수강신청 관련 상담", status: "approved", professor_note: null, suggested_start: null, suggested_end: null, student: { name: "최유진", identifier: "20250404" } },
    { id: "dummy-5", student_id: "s5", requested_start: `${dateStr(1)}T13:00:00Z`, requested_end: `${dateStr(1)}T13:30:00Z`, topic: "졸업 논문 지도", status: "pending", professor_note: null, suggested_start: null, suggested_end: null, student: { name: "정다은", identifier: "20210505" } },
    { id: "dummy-6", student_id: "s6", requested_start: `${dateStr(2)}T16:00:00Z`, requested_end: `${dateStr(2)}T16:30:00Z`, topic: "학업 부진 상담", status: "rejected", professor_note: "시간이 안 맞습니다. 다른 시간을 제안합니다.", suggested_start: `${dateStr(2)}T17:00:00Z`, suggested_end: `${dateStr(2)}T17:30:00Z`, student: { name: "강현우", identifier: "20240606" } },
  ];

  return [...result, ...dummyData] as ProfessorCounselingRequest[];
}

async function getRoadmapRequests(): Promise<RoadmapRevisionRequest[]> {
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
