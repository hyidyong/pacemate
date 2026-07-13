"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getDemoProfile } from "@/services/session.service";

async function getProfileId() {
  const profile = await getDemoProfile();
  return profile?.role === "student" ? profile.id : null;
}

function requiredText(value: FormDataEntryValue | null, fallback = "") {
  const text = typeof value === "string" ? value.trim() : "";
  return text || fallback;
}

export async function addCourseToSchedule(formData: FormData) {
  const profileId = await getProfileId();
  const courseId = requiredText(formData.get("courseId"));

  if (!profileId || !courseId) {
    return { ok: false, message: "로그인이 필요합니다." };
  }
  const supabase = await createSupabaseServerClient();

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

  const { error } = await supabase
    .from("student_courses")
    .upsert(payload, { onConflict: "student_id,course_id,status" });

  if (error) {
      return { ok: false, message: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }

  revalidatePath("/mypage");
  revalidatePath("/community");
  return { ok: true, message: "시간표에 등록했습니다." };
}

export async function toggleFavoriteCourse(formData: FormData) {
  const profileId = await getProfileId();
  const enrollmentId = requiredText(formData.get("enrollmentId"));
  const nextValue = formData.get("nextValue") === "true";

  if (!profileId || !enrollmentId) {
    return { ok: false, message: "로그인이 필요합니다." };
  }
  const supabase = await createSupabaseServerClient();

  const { error } = await supabase
    .from("student_courses")
    .update({ is_favorite: nextValue })
    .eq("id", enrollmentId)
    .eq("student_id", profileId);

  if (error) {
      return { ok: false, message: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }

  revalidatePath("/mypage");
  revalidatePath("/community");
  return { ok: true, message: nextValue ? "즐겨찾기에 추가했습니다." : "즐겨찾기를 해제했습니다." };
}

export async function removeCourseFromSchedule(formData: FormData) {
  const profileId = await getProfileId();
  const enrollmentId = requiredText(formData.get("enrollmentId"));

  if (!profileId || !enrollmentId) {
    return { ok: false, message: "로그인이 필요합니다." };
  }
  const supabase = await createSupabaseServerClient();

  const { error } = await supabase
    .from("student_courses")
    .delete()
    .eq("id", enrollmentId)
    .eq("student_id", profileId);

  if (error) {
      return { ok: false, message: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }

  revalidatePath("/mypage");
  revalidatePath("/community");
  return { ok: true, message: "시간표에서 제거했습니다." };
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
