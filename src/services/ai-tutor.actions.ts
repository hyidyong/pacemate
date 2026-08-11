"use server";

// The demo schema's student-table write policies only work for the anon role
// (the authenticated policies still compare auth.uid() to profiles.id, which
// no longer matches after the auth_user_id mapping migrations), so this module
// keeps using the anon client on purpose.
import { supabase } from "@/lib/supabase/client";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

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

export async function generateWeeklyGuide(courseId: string, studentId: string, currentWeek: number, feedback: string = "") {
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

export async function submitProgressFeedback(courseId: string, studentId: string, currentWeek: number, feedback: string) {
  // 1. Save Feedback to current week
  const { error: feedbackError } = await supabase.from("student_mission_progress").upsert({
    student_id: studentId,
    course_id: courseId,
    week_number: currentWeek,
    actual_progress_feedback: feedback,
  }, { onConflict: "student_id,course_id,week_number" });

  if (feedbackError) {
    console.error("Failed to save progress feedback:", feedbackError);
  }

  // 2. Trigger AI generation for NEXT week (currentWeek + 1)
  const nextWeek = currentWeek + 1;
  const { error: weekError } = await supabase
    .from("student_courses")
    .update({ current_week: nextWeek })
    .eq("student_id", studentId)
    .eq("course_id", courseId);

  if (weekError) {
    console.error("Failed to advance current week:", weekError);
  }

  await generateWeeklyGuide(courseId, studentId, nextWeek, feedback);
}
