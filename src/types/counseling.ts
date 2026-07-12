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

export type CounselingPageData = {
  requests: StudentCounselingRequest[];
  availableSlots: CounselingSlot[];
  courses: CounselingCourseOption[];
  professors: CounselingProfessor[];
};
