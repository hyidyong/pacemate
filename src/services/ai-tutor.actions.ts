"use server";

import { supabase } from "@/lib/supabase/client";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getDemoProfile } from "@/services/session.service";
import { normalizeQuestionCategory } from "@/lib/professor-question-normalization";

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
    .select("name, description, syllabi(parsed_text)")
    .eq("id", courseId)
    .single();

  const syllabusText = course?.syllabi?.[0]?.parsed_text || "강의 계획서 정보가 없습니다.";

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
  await supabase.from("student_mission_progress").upsert({
    student_id: studentId,
    course_id: courseId,
    week_number: currentWeek,
    actual_progress_feedback: feedback,
  }, { onConflict: "student_id,course_id,week_number" });

  // 2. Trigger AI generation for NEXT week (currentWeek + 1)
  const nextWeek = currentWeek + 1;
  await supabase.from("student_courses").update({ current_week: nextWeek }).eq("student_id", studentId).eq("course_id", courseId);
  
  await generateWeeklyGuide(courseId, studentId, nextWeek, feedback);
}

export async function askAiTutor(message: string) {
  const profile = await getDemoProfile();
  const question = message.trim();
  if (!profile || profile.role !== "student" || !question || question.length > 2000) {
    return { response: "질문을 확인할 수 없습니다.", isEscalated: false, sourceMessageId: null };
  }
  const requestSupabase = await createSupabaseServerClient();
  // 1. Fetch available contextual data (Notices, FAQs, Syllabi, etc.)
  const { data: faqs } = await requestSupabase.from("faqs").select("question, answer").limit(5);
  const { data: courses } = await requestSupabase.from("courses").select("name, description");

  const pdfSyllabusMock = `
[PDF 강의계획서 데이터]
1. 기초반도체공학 (남민우 교수)
- 학점: 3, 평가: 출석 10, 중간 40, 기말 40, 과제 10
- 목표: 고체 결정구조, 양자이론, 평형상태, pn접합 다이오드 이해

2. 전자회로설계응용 (백승훈 교수)
- 학점: 3, 평가: 출석 10, 중간 30, 기말 35, 과제 15, 태도 10
- 목표: 트랜지스터, 연산증폭기(Op-Amp) 회로 설계 및 LTSpice 검증

3. 전자기학(1) (박재희 교수)
- 학점: 3, 평가: 출석 10, 중간 40, 기말 40, 과제 10
- 목표: 벡터 해석, 쿨롱/가우스 법칙, 전위, 커패시턴스 분석

4. 통신이론및시스템 (우성호 교수)
- 학점: 3, 평가: 출석 10, 중간 35, 기말 35, 과제 20
- 목표: 푸리에 해석, AM/FM 변조, 디지털 변조 통신 방식의 이해
`;

  const contextData = `
공식 소스 (FAQs):
${faqs?.map((faq) => `Q: ${faq.question}\nA: ${faq.answer}`).join("\n\n")}

과목 정보:
${courses?.map((c) => `${c.name}: ${c.description}`).join("\n")}
${pdfSyllabusMock}
`;

  const systemPrompt = `너는 PaceMate의 AI 학습 튜터야.
학생의 질문을 다음 중 하나의 카테고리로 분류해: "과목 정보", "학사 행정", "수업 운영", "로드맵", "상담 필요".
반드시 제공된 공식 소스(공지, 강의계획서, FAQ, 교수/조교 답변)를 기반으로 답변해야 해.
만약 정보가 부족하거나 확신이 서지 않는다면 답변에 "공식 소스에 포함되어 있지 않습니다" 또는 "확인할 수 없습니다"라는 문구를 포함시키고, 신뢰도(confidence)를 0.7 미만으로 설정해.
신뢰도가 낮은 답변은 자동으로 교수나 조교에게 에스컬레이션 될 거야.

응답 형태 (JSON):
{
  "category": "분류 카테고리",
  "confidence": 0.0 ~ 1.0,
  "response": "학생에게 전달할 답변 텍스트"
}`;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `참고 자료:\n${contextData}\n\n학생 질문: ${question}` },
        ],
        response_format: { type: "json_object" },
        temperature: 0.1,
      }),
    });

    if (!res.ok) {
      return { response: "AI 응답을 불러오지 못했습니다.", isEscalated: false, sourceMessageId: null };
    }

    const json = await res.json();
    const result = JSON.parse(json.choices[0].message.content);
    const category = normalizeQuestionCategory(
      typeof result.category === "string" ? result.category : "",
    ) ?? "수업 운영";

    let isEscalated = false;
    let finalResponse = result.response;

    const exceptionKeywords = ["공식 소스에 포함되어 있지 않습니다", "확인할 수 없습니다", "정보가 없습니다"];
    const hasExceptionKeyword = exceptionKeywords.some(kw => finalResponse.includes(kw));

    if (result.confidence < 0.7 || category === "상담 필요" || hasExceptionKeyword) {
      isEscalated = true;
      finalResponse = "[AI 신뢰도 낮음] 이 질문은 정확한 답변을 위해 교수님/조교님께 전달하시는 것을 권장합니다.\n\n" + result.response;
    }

    let sourceMessageId: string | null = null;
    if (isEscalated) {
      const { data: session, error: sessionError } = await requestSupabase
        .from("chat_sessions")
        .insert({ user_id: profile.id, title: question.slice(0, 80) })
        .select("id")
        .single();
      if (!sessionError && session) {
        const { data: sourceMessage, error: sourceError } = await requestSupabase
          .from("chat_messages")
          .insert({ session_id: session.id, role: "user", content: question })
          .select("id")
          .single();
        if (!sourceError && sourceMessage) {
          sourceMessageId = sourceMessage.id;
          await requestSupabase.from("chat_messages").insert({
            session_id: session.id,
            role: "assistant",
            content: finalResponse,
            confidence: typeof result.confidence === "number" ? result.confidence : null,
            source_json: { category, escalated: true },
          });
        }
      }
    }

    return { response: finalResponse, category, isEscalated, sourceMessageId };
  } catch {
    return { response: "AI 응답 처리 중 오류가 발생했습니다.", isEscalated: false, sourceMessageId: null };
  }
}
