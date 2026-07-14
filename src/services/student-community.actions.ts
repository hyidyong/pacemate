"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getDemoProfile } from "@/services/session.service";
import type { CourseRecord, StudentCourseRecord } from "@/services/student-community.service";
import { syncStudentCourseSchedule } from "@/services/student-timetable.service";
import { validateScheduleSlots, type ScheduleSlot, type ScheduleSlotInput } from "@/services/student-timetable.rules";

const studentCourseSelectColumns =
  "id, status, is_favorite, schedule_day, start_time, end_time, classroom, semester_label, course:courses(id, school_id, code, name, credit, category, description, prerequisite_text), schedule_slots:student_course_schedule_slots(id, day_of_week, start_time, end_time, classroom)";

async function getProfileId() {
  const profile = await getDemoProfile();
  return profile?.role === "student" ? profile.id : null;
}

function createStudentCommunitySupabaseClient() {
  try {
    return createSupabaseAdminClient();
  } catch (error) {
    console.error("Student timetable Supabase admin client is unavailable", error);
    return null;
  }
}

function requiredText(value: FormDataEntryValue | null, fallback = "") {
  const text = typeof value === "string" ? value.trim() : "";
  return text || fallback;
}

function readScheduleSlots(formData: FormData): ScheduleSlot[] {
  const raw = formData.get("scheduleSlots");
  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) return validateScheduleSlots(parsed as ScheduleSlotInput[]);
    } catch {
      return [];
    }
  }
  return validateScheduleSlots([{
    dayOfWeek: requiredText(formData.get("scheduleDay")),
    startTime: requiredText(formData.get("startTime"), "09:00"),
    endTime: requiredText(formData.get("endTime"), "10:15"),
    classroom: requiredText(formData.get("classroom")),
  }]);
}

function revalidateTimetablePaths() {
  revalidatePath("/mypage");
  revalidatePath("/dashboard");
}

function normalizeJoinedStudentCourse(record: unknown): StudentCourseRecord | null {
  if (!record || typeof record !== "object") return null;

  const row = record as {
    id?: unknown;
    status?: unknown;
    is_favorite?: unknown;
    schedule_day?: unknown;
    start_time?: unknown;
    end_time?: unknown;
    classroom?: unknown;
    semester_label?: unknown;
    schedule_slots?: unknown;
    course?: unknown;
  };
  const joinedCourse = Array.isArray(row.course) ? row.course[0] : row.course;

  if (!joinedCourse || typeof joinedCourse !== "object") return null;

  const course = joinedCourse as Partial<CourseRecord>;
  if (
    typeof row.id !== "string" ||
    typeof row.status !== "string" ||
    typeof row.is_favorite !== "boolean" ||
    typeof course.id !== "string" ||
    typeof course.code !== "string" ||
    typeof course.name !== "string" ||
    typeof course.credit !== "number"
  ) {
    return null;
  }

  return {
    id: row.id,
    status: row.status as StudentCourseRecord["status"],
    is_favorite: row.is_favorite,
    schedule_day: typeof row.schedule_day === "string" ? row.schedule_day : null,
    start_time: typeof row.start_time === "string" ? row.start_time : null,
    end_time: typeof row.end_time === "string" ? row.end_time : null,
    classroom: typeof row.classroom === "string" ? row.classroom : null,
    semester_label: typeof row.semester_label === "string" ? row.semester_label : "2026-2",
    schedule_slots: Array.isArray(row.schedule_slots)
      ? row.schedule_slots.flatMap((slot) => {
          if (!slot || typeof slot !== "object") return [];
          const value = slot as Record<string, unknown>;
          if (
            typeof value.id !== "string" ||
            typeof value.day_of_week !== "string" ||
            typeof value.start_time !== "string" ||
            typeof value.end_time !== "string"
          ) return [];
          return [{
            id: value.id,
            day_of_week: value.day_of_week,
            start_time: value.start_time,
            end_time: value.end_time,
            classroom: typeof value.classroom === "string" ? value.classroom : null,
          }];
        })
      : [],
    course: {
      id: course.id,
      school_id: typeof course.school_id === "string" ? course.school_id : null,
      code: course.code,
      name: course.name,
      credit: course.credit,
      category: typeof course.category === "string" ? course.category : null,
      description: typeof course.description === "string" ? course.description : null,
      prerequisite_text:
        typeof course.prerequisite_text === "string" ? course.prerequisite_text : null,
    },
  };
}

export async function addCourseToSchedule(formData: FormData) {
  const profileId = await getProfileId();
  const courseId = requiredText(formData.get("courseId"));

  if (!profileId || !courseId) {
    return { ok: false, message: "로그인이 필요합니다." };
  }
  const supabase = createStudentCommunitySupabaseClient();
  if (!supabase) {
    return { ok: false, message: "시간표 데이터베이스 설정을 확인해 주세요." };
  }

  const manualSlots = readScheduleSlots(formData);
  if (!manualSlots.length) {
    return { ok: false, message: "At least one valid day and time is required." };
  }
  const payload = {
    student_id: profileId,
    course_id: courseId,
    status: "interested",
    is_favorite: formData.get("isFavorite") === "true",
    schedule_day: requiredText(formData.get("scheduleDay"), "월"),
    start_time: requiredText(formData.get("startTime"), "09:00"),
    end_time: requiredText(formData.get("endTime"), "10:15"),
    classroom: requiredText(formData.get("classroom"), "강의실 미정"),
    semester_label: requiredText(formData.get("semesterLabel"), "2026-2"),
    source_text: "mypage",
  };

  // The legacy columns remain a compatibility snapshot of the first slot.
  payload.schedule_day = manualSlots[0].dayOfWeek;
  payload.start_time = manualSlots[0].startTime;
  payload.end_time = manualSlots[0].endTime;
  payload.classroom = manualSlots[0].classroom ?? "";

  const { data: existing, error: lookupError } = await supabase
    .from("student_courses")
    .select("id")
    .eq("student_id", profileId)
    .eq("course_id", courseId)
    .eq("status", payload.status)
    .maybeSingle();

  if (lookupError) {
    console.error("addCourseToSchedule lookup failed:", lookupError.message);
    return { ok: false, message: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }

  const { data, error } = existing?.id
    ? await supabase
        .from("student_courses")
        .update(payload)
        .eq("id", existing.id)
        .eq("student_id", profileId)
        .select(studentCourseSelectColumns)
        .single()
    : await supabase
        .from("student_courses")
        .insert(payload)
        .select(studentCourseSelectColumns)
        .single();

  if (error) {
    console.error("addCourseToSchedule failed:", error.message);
    return { ok: false, message: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }

  const studentCourseId = typeof (data as { id?: unknown })?.id === "string"
    ? (data as { id: string }).id
    : null;
  if (!studentCourseId) {
    return { ok: false, message: "시간표 수강 정보를 확인하지 못했습니다." };
  }

  try {
    await syncStudentCourseSchedule({
      supabase,
      studentCourseId,
      courseId,
      semesterLabel: payload.semester_label,
      manualSlots,
    });
  } catch (syncError) {
    console.error("addCourseToSchedule schedule sync failed", syncError);
    if (!existing?.id) {
      await supabase.from("student_courses").delete().eq("id", studentCourseId).eq("student_id", profileId);
    }
    return { ok: false, message: "시간표를 안전하게 동기화하지 못했습니다. 기존 시간표는 유지됩니다." };
  }

  revalidatePath("/mypage");
  revalidatePath("/dashboard");
  revalidatePath("/roadmap");
  revalidatePath("/notices");
  return {
    ok: true,
    message: "시간표에 등록했습니다.",
    course: normalizeJoinedStudentCourse(data),
  };
}

export async function saveCustomCourseToSchedule(formData: FormData) {
  const profileId = await getProfileId();
  const title = requiredText(formData.get("title"));
  const customCourseId = requiredText(formData.get("customCourseId"));
  const slots = readScheduleSlots(formData);
  if (!profileId || !title || !slots.length) {
    return { ok: false, message: "A title and at least one valid day and time are required." };
  }
  const supabase = createStudentCommunitySupabaseClient();
  if (!supabase) return { ok: false, message: "Timetable storage is unavailable." };

  const color = requiredText(formData.get("color")) || null;
  const { data: customCourse, error: courseError } = customCourseId
    ? await supabase.from("student_custom_courses").update({ title, color })
        .eq("id", customCourseId).eq("student_id", profileId).select("id, title, color").single()
    : await supabase.from("student_custom_courses").insert({ student_id: profileId, title, color })
        .select("id, title, color").single();
  if (courseError || !customCourse?.id) {
    console.error("saveCustomCourseToSchedule failed:", courseError?.message);
    return { ok: false, message: "Unable to save the custom course." };
  }

  const { error: slotError } = await supabase.rpc("replace_student_custom_course_schedule_slots", {
    p_student_custom_course_id: customCourse.id,
    p_slots: slots.map((slot) => ({
      day_of_week: slot.dayOfWeek,
      start_time: slot.startTime,
      end_time: slot.endTime,
      classroom: slot.classroom,
    })),
  });
  if (slotError) {
    // A newly-created parent has no value without its time slots.  Remove it
    // on failure; existing parents retain their pre-existing slot set because
    // the RPC rolls its delete and insert back together.
    if (!customCourseId) {
      await supabase.from("student_custom_courses").delete()
        .eq("id", customCourse.id).eq("student_id", profileId);
    }
    return { ok: false, message: "Unable to save custom course times." };
  }

  const { data: savedSlots, error: savedSlotsError } = await supabase
    .from("student_custom_course_schedule_slots")
    .select("id, day_of_week, start_time, end_time, classroom")
    .eq("student_custom_course_id", customCourse.id)
    .order("day_of_week", { ascending: true })
    .order("start_time", { ascending: true });
  if (savedSlotsError) return { ok: false, message: "Unable to load custom course times." };

  const course: StudentCourseRecord = {
    id: `custom:${customCourse.id}`, status: "interested", is_favorite: false,
    schedule_day: null, start_time: null, end_time: null, classroom: null, semester_label: "2026-2",
    is_custom: true, custom_course_id: customCourse.id, timetable_color: customCourse.color ?? null,
    schedule_slots: savedSlots ?? [],
    course: { id: `custom:${customCourse.id}`, school_id: null, code: "CUSTOM", name: customCourse.title,
      credit: 0, category: "custom", description: null, prerequisite_text: null },
  };
  revalidateTimetablePaths();
  return { ok: true, message: "Custom course saved.", course };
}

export async function removeCustomCourseFromSchedule(formData: FormData) {
  const profileId = await getProfileId();
  const customCourseId = requiredText(formData.get("customCourseId"));
  if (!profileId || !customCourseId) return { ok: false, message: "Custom course not found." };
  const supabase = createStudentCommunitySupabaseClient();
  if (!supabase) return { ok: false, message: "Timetable storage is unavailable." };

  // Database FK cascade deletes this course's slots, without touching the
  // authoritative student_courses row used by roadmap and notices.
  const { error } = await supabase.from("student_custom_courses").delete()
    .eq("id", customCourseId).eq("student_id", profileId);
  if (error) return { ok: false, message: "Unable to remove the custom course." };
  revalidateTimetablePaths();
  return { ok: true, message: "Custom course removed." };
}

export async function toggleFavoriteCourse(formData: FormData) {
  const profileId = await getProfileId();
  const enrollmentId = requiredText(formData.get("enrollmentId"));
  const nextValue = formData.get("nextValue") === "true";

  if (!profileId || !enrollmentId) {
    return { ok: false, message: "로그인이 필요합니다." };
  }
  const supabase = createStudentCommunitySupabaseClient();
  if (!supabase) {
    return { ok: false, message: "시간표 데이터베이스 설정을 확인해 주세요." };
  }

  const { error } = await supabase
    .from("student_courses")
    .update({ is_favorite: nextValue })
    .eq("id", enrollmentId)
    .eq("student_id", profileId);

  if (error) {
    console.error("toggleFavoriteCourse failed:", error.message);
    return { ok: false, message: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }

  revalidatePath("/mypage");
  revalidatePath("/dashboard");
  return { ok: true, message: nextValue ? "즐겨찾기에 추가했습니다." : "즐겨찾기를 해제했습니다." };
}

export async function removeCourseFromSchedule(formData: FormData) {
  const profileId = await getProfileId();
  const enrollmentId = requiredText(formData.get("enrollmentId"));

  if (!profileId || !enrollmentId) {
    return { ok: false, message: "로그인이 필요합니다." };
  }
  const supabase = createStudentCommunitySupabaseClient();
  if (!supabase) {
    return { ok: false, message: "시간표 데이터베이스 설정을 확인해 주세요." };
  }

  const { data: existing, error: lookupError } = await supabase
    .from("student_courses")
    .select("id")
    .eq("id", enrollmentId)
    .eq("student_id", profileId)
    .maybeSingle();

  if (lookupError) {
    console.error("removeCourseFromSchedule lookup failed:", lookupError.message);
    return { ok: false, message: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }

  if (!existing?.id) {
    return { ok: false, message: "삭제할 시간표를 찾을 수 없습니다." };
  }

  const { error } = await supabase
    .from("student_courses")
    .delete()
    .eq("id", existing.id)
    .eq("student_id", profileId);

  if (error) {
    console.error("removeCourseFromSchedule failed:", error.message);
    return { ok: false, message: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }

  revalidatePath("/mypage");
  revalidatePath("/dashboard");
  revalidatePath("/roadmap");
  return { ok: true, message: "시간표에서 제거했습니다.", enrollmentId: existing.id as string };
}

export async function createCommunityPost(formData: FormData) {
  const profileId = await getProfileId();
  const title = requiredText(formData.get("title"));
  const content = requiredText(formData.get("content"));
  const category = requiredText(formData.get("category"), "question");
  const courseId = requiredText(formData.get("courseId"));
  const schoolId = requiredText(formData.get("schoolId"));
  const displayMode = requiredText(formData.get("displayMode"), "anonymous");

  if (!profileId) {
    return { ok: false, message: "로그인이 필요합니다." };
  }

  if (!title || !content) {
    return { ok: false, message: "제목과 내용을 입력해 주세요." };
  }
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("posts")
    .insert({
      author_id: profileId,
      community_type: "student",
      school_id: schoolId || null,
      course_id: courseId || null,
      category,
      board_key: category,
      title,
      content,
      display_mode: displayMode,
      anonymous_alias: displayMode === "anonymous" ? "익명" : null,
      status: "active",
    })
    .select("id")
    .single();

  if (error) {
      return { ok: false, message: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }

  revalidatePath("/community");
  return { ok: true, message: "글을 등록했습니다.", postId: data.id as string };
}

export async function addCommunityComment(formData: FormData) {
  const profileId = await getProfileId();
  const postId = requiredText(formData.get("postId"));
  const content = requiredText(formData.get("content"));
  const displayMode = requiredText(formData.get("displayMode"), "anonymous");

  if (!profileId || !postId || !content) {
    return { ok: false, message: "댓글 내용을 입력해 주세요." };
  }
  const supabase = await createSupabaseServerClient();

  const { data: post } = await supabase
    .from("posts")
    .select("id")
    .eq("id", postId)
    .eq("community_type", "student")
    .maybeSingle();
  if (!post) {
    return { ok: false, message: "댓글을 등록할 수 없는 게시글입니다." };
  }

  const { data, error } = await supabase
    .from("comments")
    .insert({
      post_id: postId,
      author_id: profileId,
      content,
      display_mode: displayMode,
      anonymous_alias: displayMode === "anonymous" ? "익명" : null,
      status: "active",
    })
    .select("id")
    .single();

  if (error) {
      return { ok: false, message: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }

  revalidatePath("/community");
  revalidatePath("/mypage");
  return { ok: true, message: "댓글을 등록했습니다.", commentId: data.id as string };
}

export async function togglePostReaction(formData: FormData) {
  const profileId = await getProfileId();
  const postId = requiredText(formData.get("postId"));
  const type = requiredText(formData.get("type"));

  if (!profileId || !postId || (type !== "like" && type !== "scrap")) {
    return { ok: false, message: "반응을 저장할 수 없습니다." };
  }
  const supabase = await createSupabaseServerClient();

  const { data: post } = await supabase
    .from("posts")
    .select("id")
    .eq("id", postId)
    .eq("community_type", "student")
    .maybeSingle();
  if (!post) {
    return { ok: false, message: "반응을 저장할 수 없는 게시글입니다." };
  }

  const { data: existing } = await supabase
    .from("post_reactions")
    .select("id")
    .eq("post_id", postId)
    .eq("user_id", profileId)
    .eq("type", type)
    .maybeSingle();

  if (existing?.id) {
    const { error } = await supabase
      .from("post_reactions")
      .delete()
      .eq("id", existing.id);

    if (error) {
    return { ok: false, message: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." };
    }

    revalidatePath("/community");
    revalidatePath("/mypage");
    return { ok: true, message: "반응을 취소했습니다.", active: false };
  }

  const { error } = await supabase
    .from("post_reactions")
    .insert({ post_id: postId, user_id: profileId, type });

  if (error) {
    return { ok: false, message: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }

  revalidatePath("/community");
  revalidatePath("/mypage");
  return { ok: true, message: "저장했습니다.", active: true };
}
