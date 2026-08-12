"use server";

// The demo schema's student-table write policies only work for the anon role
// (the authenticated policies still compare auth.uid() to profiles.id, which
// no longer matches after the auth_user_id mapping migrations), so this module
// keeps using the anon client on purpose.
import { supabase } from "@/lib/supabase/client";
import { getDemoProfile } from "@/services/session.service";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Stage 8 P0-2. Both exported actions previously took `studentId` from the
// caller and never resolved a session, so anyone holding the (publicly
// discoverable) action id could write another student's progress, advance
// another student's course week, and spend OpenAI credits without an account.
// The acting student is now resolved server-side and the parameter is ignored;
// the signature is preserved so the existing call sites and UI are untouched.
async function resolveActingStudent() {
  const profile = await getDemoProfile();
  if (!profile || profile.role !== "student" || !profile.school_id) {
    return null;
  }
  return { id: profile.id, schoolId: profile.school_id };
}

// Review finding 2. Deriving studentId from the session closed the identity
// hole but left courseId and currentWeek caller-supplied and unvalidated, so a
// student could name ANOTHER UNIVERSITY'S course id: its syllabus text would be
// read and sent to OpenAI (cross-tenant exfiltration through the prompt) and
// progress rows written for a course they do not own.
//
// Authorization is now derived from the student's OWN enrollment, joined to the
// course's tenant. `.limit(1).maybeSingle()` rather than a bare `maybeSingle()`
// because student_courses is unique on (student_id, course_id, STATUS), so one
// student legitimately has several rows for the same course (KI-012).
// Returns the AUTHORITATIVE week for this enrollment, or null when the student
// may not act on this course at all.
async function authorizeCourseForStudent(
  studentId: string,
  schoolId: string,
  courseId: string,
): Promise<{ currentWeek: number } | null> {
  if (!courseId) return null;

  const { data, error } = await supabase
    .from("student_courses")
    .select("course_id, current_week, course:courses!inner(id, school_id)")
    .eq("student_id", studentId)
    .eq("course_id", courseId)
    .eq("course.school_id", schoolId)
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  const currentWeek = (data as { current_week?: number }).current_week;
  return isValidWeek(currentWeek) ? { currentWeek } : null;
}

// A course week is a small positive integer, matched by the
// student_courses_current_week_range CHECK constraint.
const MAX_COURSE_WEEK = 30;

function isValidWeek(week: unknown): week is number {
  return typeof week === "number" && Number.isInteger(week) && week >= 1 && week <= MAX_COURSE_WEEK;
}

// Review round 3, finding 2. Bounding the week to 1..30 only rejects absurd
// input; a week inside that range is still caller-supplied and proves nothing.
// The enrollment row holds the authoritative week, so the caller's value is
// treated purely as an optimistic-concurrency token: it must match, or the
// request is stale (an out-of-date tab) or forged (an attempt to read/overwrite
// a week the student has not reached). Either way it is rejected BEFORE the
// syllabus read, the OpenAI call, any progress write, and any advance.
function isAuthorizedWeek(claimedWeek: number, authoritativeWeek: number): boolean {
  return isValidWeek(claimedWeek) && claimedWeek === authoritativeWeek;
}

// The OpenAI call previously had no timeout, so a slow upstream pinned the
// serverless invocation until the platform killed it. Matches the bound already
// used by ai-tutor-rag.actions.ts.
const OPENAI_TIMEOUT_MS = 20000;

const SYSTEM_PROMPT = `너는 PaceMate의 AI 학습 튜터야. 
반드시 사용자가 업로드한 [강의 계획서 및 교과서 파일]의 정보에만 기반해서 답변해야 해.
만약 사용자가 물어본 내용이 파일 안에 없는 내용이거나 알 수 없는 정보라면, 억지로 지어내지 말고 오직 "제공된 파일 내(강의 계획서, 강의 정보, 교과서 파일, 교수 질의 응답, 다른 학생 질의 응답 등)에서 해당 내용을 찾을 수 없습니다"라고만 답변해 줘. 외부 지식을 임의로 활용해서 설명하는 것은 절대 금지야. 모르는 내용이 있으면 교수에게 연결해줘.

추가 지시사항:
- 학습자의 현재 주차(week), 강의계획서 정보, 기존 피드백을 반영하여 [예상 진도]와 [예/복습 가이드]를 JSON 형태로 응답해.
- 복습 퀴즈는 간단하게 텍스트로 가이드만 제공해 (토큰 절약).
- 응답 형태 (JSON): 
{
  "predicted_progress_text": "이번 주 예상 진도 설명...",
  "prep_review_guide": "예습 및 복습 가이드..."
}`;

export async function generateWeeklyGuide(
  courseId: string,
  _studentId: string,
  currentWeek: number,
  feedback: string = "",
) {
  const student = await resolveActingStudent();
  if (!student) {
    return null;
  }
  const studentId = student.id;

  // Authorize BEFORE reading the syllabus or calling OpenAI: the course text
  // becomes prompt content, so an unauthorized read is already a disclosure.
  const enrollment = await authorizeCourseForStudent(studentId, student.schoolId, courseId);
  if (!enrollment || !isAuthorizedWeek(currentWeek, enrollment.currentWeek)) {
    return null;
  }

  // 1. Fetch Course & Syllabus
  const { data: course } = await supabase
    .from("courses")
    .select("name, description, syllabi(parsed_text, raw_extracted_text)")
    .eq("id", courseId)
    .single();

  const syllabusText =
    course?.syllabi?.[0]?.raw_extracted_text ||
    course?.syllabi?.[0]?.parsed_text ||
    "강의 계획서 정보가 없습니다.";

  // 2. Fetch Student Profile
  const { data: profile } = await supabase
    .from("student_profiles")
    .select("target_career, interests, weak_basics")
    .eq("profile_id", studentId)
    .single();

  const userPrompt = `
과목명: ${course?.name}
설명: ${course?.description}
강의계획서 내용: ${syllabusText}
학생 정보 (관심분야/목표): ${profile?.interests?.join(", ")} / ${profile?.target_career}
현재 주차: ${currentWeek}주차
${feedback ? `학생의 이전 실제 진도 피드백: "${feedback}" (이 피드백을 반영해서 진도를 보정할 것)` : ""}

위 데이터를 바탕으로 이번 ${currentWeek}주차에 해당하는 예상 진도와 예/복습 가이드를 JSON 포맷으로 생성해줘.`;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini", // Use mini for speed/cost efficiency
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.2,
      }),
      signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS),
    });

    if (!res.ok) {
      console.error("OpenAI API Error:", await res.text());
      throw new Error("AI API 연동에 실패했습니다.");
    }

    const json = await res.json();
    const resultContent = JSON.parse(json.choices[0].message.content);

    // Save to Database
    const { error: insertError } = await supabase.from("student_mission_progress").upsert({
      student_id: studentId,
      course_id: courseId,
      week_number: currentWeek,
      calibrated_mission_json: resultContent,
      calibrated_by_ai: true,
    }, { onConflict: "student_id,course_id,week_number" });

    if (insertError) {
      console.error("DB Insert Error:", insertError);
    }

    return resultContent;
  } catch (error) {
    console.error(error);
    return null;
  }
}

export async function submitProgressFeedback(
  courseId: string,
  _studentId: string,
  currentWeek: number,
  feedback: string,
) {
  const student = await resolveActingStudent();
  if (!student) {
    return;
  }
  const studentId = student.id;

  // Same authorization gate as generateWeeklyGuide: this path writes progress
  // AND advances student_courses.current_week, so neither an unowned courseId
  // nor an unauthorized week may reach either statement.
  const enrollment = await authorizeCourseForStudent(studentId, student.schoolId, courseId);
  if (!enrollment || !isAuthorizedWeek(currentWeek, enrollment.currentWeek)) {
    return;
  }

  // Every week below is the SERVER's value, never the caller's — the caller's
  // was only ever an equality token checked above.
  const authorizedWeek = enrollment.currentWeek;

  // 1. Save Feedback to current week
  const { error: feedbackError } = await supabase.from("student_mission_progress").upsert({
    student_id: studentId,
    course_id: courseId,
    week_number: authorizedWeek,
    actual_progress_feedback: feedback,
  }, { onConflict: "student_id,course_id,week_number" });

  if (feedbackError) {
    console.error("Failed to save progress feedback:", feedbackError);
  }

  // 2. Trigger AI generation for NEXT week. The final week of a course has no
  // next week to advance into; stop rather than writing a value the
  // student_courses_current_week_range constraint would reject.
  const nextWeek = authorizedWeek + 1;
  if (!isValidWeek(nextWeek)) {
    return;
  }

  // Compare-and-set on the week we authorized against, so two concurrent
  // submissions cannot advance the enrollment twice.
  const { error: weekError } = await supabase
    .from("student_courses")
    .update({ current_week: nextWeek })
    .eq("student_id", studentId)
    .eq("course_id", courseId)
    .eq("current_week", authorizedWeek);

  if (weekError) {
    console.error("Failed to advance current week:", weekError);
  }

  await generateWeeklyGuide(courseId, _studentId, nextWeek, feedback);
}
