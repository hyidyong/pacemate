import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isMissingTimetableSchema } from "@/lib/student-timetable-schema";
import type { DemoProfile } from "@/services/session.service";

export type CourseRecord = {
  id: string;
  school_id: string | null;
  code: string;
  name: string;
  credit: number;
  category: string | null;
  description: string | null;
  prerequisite_text: string | null;
};

export type StudentCourseRecord = {
  id: string;
  status: "completed" | "interested" | "recommended";
  is_favorite: boolean;
  schedule_day: string | null;
  start_time: string | null;
  end_time: string | null;
  classroom: string | null;
  semester_label: string;
  course: CourseRecord;
  /** Normalized schedule rows are the source of truth for timetable rendering. */
  schedule_slots?: ScheduleSlotRecord[];
  /** Custom courses deliberately never create a student_courses record. */
  is_custom?: boolean;
  custom_course_id?: string;
  timetable_color?: string | null;
};

export type ScheduleSlotRecord = {
  id: string;
  day_of_week: string;
  start_time: string;
  end_time: string;
  classroom: string | null;
};

export type CommunityPostRecord = {
  id: string;
  author_id: string | null;
  category: string;
  board_key: string;
  title: string;
  content: string;
  course_id: string | null;
  school_id: string | null;
  display_mode: string;
  anonymous_alias: string | null;
  view_count: number;
  is_resolved: boolean;
  created_at: string;
  course: Pick<CourseRecord, "id" | "code" | "name"> | null;
  author: { id: string; name: string; role: string } | null;
  likes: number;
  scraps: number;
  comments: number;
  is_liked: boolean;
  is_scrapped: boolean;
};

export type CommunityCommentRecord = {
  id: string;
  post_id: string;
  author_id: string | null;
  content: string;
  display_mode: string;
  anonymous_alias: string | null;
  created_at: string;
  author: { id: string; name: string; role: string } | null;
};

export type CommunityData = {
  schoolName: string;
  profile: DemoProfile | null;
  courses: CourseRecord[];
  myCourses: StudentCourseRecord[];
  posts: CommunityPostRecord[];
};

export type MyPageData = {
  schoolName: string;
  profile: DemoProfile | null;
  courses: CourseRecord[];
  myCourses: StudentCourseRecord[];
  myPosts: CommunityPostRecord[];
  scrapedPosts: CommunityPostRecord[];
  commentedPosts: CommunityPostRecord[];
  likedPosts: CommunityPostRecord[];
  savedProfile?: any;
};

const defaultSchoolName = "계명대학교";
const postSelectColumns =
  "id, author_id, category, board_key, title, content, course_id, school_id, display_mode, anonymous_alias, view_count, is_resolved, created_at, course:courses(id, code, name), author:profiles(id, name, role)";

function isMissingCommunityTypeColumn(error: { code?: string; message?: string } | null) {
  return Boolean(
    error &&
      (error.code === "42703" ||
        error.message?.includes("posts.community_type") ||
        error.message?.includes("community_type")),
  );
}

export async function ensureProfileSchool(profile: DemoProfile | null) {
  if (!profile || profile.school_id) {
    return;
  }
  const supabase = await createSupabaseServerClient();

  const { data: school } = await supabase
    .from("schools")
    .select("id")
    .eq("name", defaultSchoolName)
    .maybeSingle();

  if (school?.id) {
    await supabase
      .from("profiles")
      .update({ school_id: school.id })
      .eq("id", profile.id);
  }
}

export async function getMyPageData(
  profile: DemoProfile | null,
): Promise<MyPageData> {
  const supabase = await createSupabaseServerClient();
  await ensureProfileSchool(profile);
  const [schoolName, courses, myCourses] = await Promise.all([
    getSchoolName(profile),
    getCourses(),
    getMyCourses(profile),
  ]);
  const [myPosts, scrapedPosts, commentedPosts, likedPosts] = await Promise.all([
    getMyPosts(profile?.id),
    getScrapedPosts(profile?.id),
    getCommentedPosts(profile?.id),
    getLikedPosts(profile?.id),
  ]);

  let savedProfile = null;
  if (profile?.id && profile.role === "student") {
    const { data } = await supabase
      .from("student_profiles")
      .select("*")
      .eq("profile_id", profile.id)
      .maybeSingle();
    savedProfile = data;
  }

  return { schoolName, profile, courses, myCourses, myPosts, scrapedPosts, commentedPosts, likedPosts, savedProfile };
}

export async function getCommunityData(
  profile: DemoProfile | null,
): Promise<CommunityData> {
  await ensureProfileSchool(profile);
  const [schoolName, courses, myCourses, posts] = await Promise.all([
    getSchoolName(profile),
    getCourses(),
    getMyCourses(profile),
    getPosts(profile?.id),
  ]);

  return { schoolName, profile, courses, myCourses, posts };
}

async function getSchoolName(profile: DemoProfile | null) {
  const supabase = await createSupabaseServerClient();
  if (profile?.school_id) {
    const { data } = await supabase
      .from("schools")
      .select("name")
      .eq("id", profile.school_id)
      .maybeSingle();

    if (data?.name) {
      return data.name;
    }
  }

  return defaultSchoolName;
}

async function getCourses(): Promise<CourseRecord[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("courses")
    .select(
      "id, school_id, code, name, credit, category, description, prerequisite_text",
    )
    .order("name", { ascending: true });

  if (error) {
    throw new Error(`Failed to load courses: ${error.message}`);
  }

  return (data ?? []) as CourseRecord[];
}

export async function getMyCourses(
  profile: DemoProfile | null,
): Promise<StudentCourseRecord[]> {
  if (!profile || profile.role !== "student") {
    return [];
  }
  const profileId = profile.id;

  const selectCourses = (
    supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
    includeScheduleSlots = true,
  ) =>
    supabase
      .from("student_courses")
      .select(
        includeScheduleSlots
          ? "id, status, is_favorite, schedule_day, start_time, end_time, classroom, semester_label, course:courses(id, school_id, code, name, credit, category, description, prerequisite_text), schedule_slots:student_course_schedule_slots(id, day_of_week, start_time, end_time, classroom)"
          : "id, status, is_favorite, schedule_day, start_time, end_time, classroom, semester_label, course:courses(id, school_id, code, name, credit, category, description, prerequisite_text)",
      )
      .eq("student_id", profileId)
      .order("updated_at", { ascending: false });

  let supabase = await createSupabaseServerClient();
  let { data, error } = await selectCourses(supabase);

  // Some deployed environments still have the original student_courses
  // columns but not the newer slot table. Those legacy rows are enough for
  // the timetable renderer, so retry without the embedded relation.
  if (error && isMissingTimetableSchema(error)) {
    ({ data, error } = await selectCourses(supabase, false));
  }

  // Demo sessions are HMAC-signed by this server, but an older browser can
  // retain that session after its Supabase Auth refresh cookie expires. Keep
  // the student-facing read available in that case without granting table
  // access to the anonymous database role. The id comes from getDemoProfile,
  // which verifies the signed session before this server-only function runs.
  if (error?.code === "42501") {
    console.warn("Falling back to verified server-side timetable read", error.message);
    supabase = createSupabaseAdminClient();
    ({ data, error } = await selectCourses(supabase));
    if (error && isMissingTimetableSchema(error)) {
      ({ data, error } = await selectCourses(supabase, false));
    }
  }

  if (error) {
    console.error("getMyCourses failed:", error.message);
    throw new Error(`Failed to load my courses: ${error.message}`);
  }

  const regularCourses = (data ?? []) as unknown as StudentCourseRecord[];
  const { data: customRows, error: customError } = await supabase
    .from("student_custom_courses")
    .select(
      "id, title, color, schedule_slots:student_custom_course_schedule_slots(id, day_of_week, start_time, end_time, classroom)",
    )
    .eq("student_id", profileId)
    .order("updated_at", { ascending: false });

  // Keep the established student_courses data available if an older database
  // has not yet applied the custom-course timetable migration.
  if (customError) {
    console.error("getMyCourses custom timetable lookup skipped:", customError.message);
    return regularCourses;
  }

  const customCourses = (customRows ?? []).flatMap((row) => {
    if (!row || typeof row.id !== "string" || typeof row.title !== "string") return [];
    return [{
      id: `custom:${row.id}`,
      status: "interested" as const,
      is_favorite: false,
      schedule_day: null,
      start_time: null,
      end_time: null,
      classroom: null,
      semester_label: "2026-2",
      is_custom: true,
      custom_course_id: row.id,
      timetable_color: typeof row.color === "string" ? row.color : null,
      schedule_slots: (Array.isArray(row.schedule_slots) ? row.schedule_slots : []) as ScheduleSlotRecord[],
      course: {
        id: `custom:${row.id}`,
        school_id: null,
        code: "CUSTOM",
        name: row.title,
        credit: 0,
        category: "custom",
        description: null,
        prerequisite_text: null,
      },
    } satisfies StudentCourseRecord];
  });

  return [...regularCourses, ...customCourses];
}

// Used by /courses and /courses/[id], which fetch their course list through
// the separate, anon-client course.service.ts module that carries no
// is_favorite field. Degrades to an empty set on failure since favoriting is
// a supplementary affordance, not something that should block the page.
export async function getFavoriteCourseIds(profileId: string): Promise<Set<string>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("student_courses")
    .select("course_id")
    .eq("student_id", profileId)
    .eq("is_favorite", true);

  if (error) {
    console.error("getFavoriteCourseIds failed:", error.message);
    return new Set();
  }

  return new Set((data ?? []).map((row) => row.course_id as string));
}

async function getPosts(profileId?: string): Promise<CommunityPostRecord[]> {
  const supabase = await createSupabaseServerClient();

  let { data, error } = await supabase
    .from("posts")
    .select(postSelectColumns)
    .eq("status", "active")
    .eq("community_type", "student")
    .order("created_at", { ascending: false })
    .limit(80);

  if (isMissingCommunityTypeColumn(error)) {
    console.error("getPosts community_type filter skipped:", error?.message);
    const fallback = await supabase
      .from("posts")
      .select(postSelectColumns)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(80);

    data = fallback.data;
    error = fallback.error;
  }

  if (error) {
    console.error("getPosts failed:", error.message);
    throw new Error(`Failed to load posts: ${error.message}`);
  }

  const posts = (data ?? []) as unknown as Array<
    Omit<CommunityPostRecord, "likes" | "scraps" | "comments" | "is_liked" | "is_scrapped">
  >;

  if (!posts.length) {
    return [];
  }

  const postIds = posts.map((post) => post.id);
  const { data: reactions } = await supabase
    .from("post_reactions")
    .select("post_id, user_id, type")
    .in("post_id", postIds);

  const { data: comments } = await supabase
    .from("comments")
    .select("post_id")
    .eq("status", "active")
    .in("post_id", postIds);

  const counts = new Map<string, { likes: number; scraps: number }>();
  const myReactions = new Map<string, { liked: boolean; scrapped: boolean }>();
  for (const reaction of reactions ?? []) {
    const current = counts.get(reaction.post_id) ?? { likes: 0, scraps: 0 };
    if (reaction.type === "like") {
      current.likes += 1;
    }
    if (reaction.type === "scrap") {
      current.scraps += 1;
    }
    counts.set(reaction.post_id, current);

    if (profileId && reaction.user_id === profileId) {
      const mine = myReactions.get(reaction.post_id) ?? { liked: false, scrapped: false };
      if (reaction.type === "like") {
        mine.liked = true;
      }
      if (reaction.type === "scrap") {
        mine.scrapped = true;
      }
      myReactions.set(reaction.post_id, mine);
    }
  }

  const commentCounts = new Map<string, number>();
  for (const comment of comments ?? []) {
    commentCounts.set(comment.post_id, (commentCounts.get(comment.post_id) ?? 0) + 1);
  }

  return posts.map((post) => ({
    ...post,
    likes: counts.get(post.id)?.likes ?? 0,
    scraps: counts.get(post.id)?.scraps ?? 0,
    comments: commentCounts.get(post.id) ?? 0,
    is_liked: myReactions.get(post.id)?.liked ?? false,
    is_scrapped: myReactions.get(post.id)?.scrapped ?? false,
  }));
}

export async function getPostComments(postIds: string[]): Promise<Record<string, CommunityCommentRecord[]>> {
  if (!postIds.length) {
    return {};
  }
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("comments")
    .select("id, post_id, author_id, content, display_mode, anonymous_alias, created_at, author:profiles(id, name, role)")
    .eq("status", "active")
    .in("post_id", postIds)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to load comments: ${error.message}`);
  }

  const grouped: Record<string, CommunityCommentRecord[]> = {};
  for (const comment of (data ?? []) as unknown as CommunityCommentRecord[]) {
    grouped[comment.post_id] = [...(grouped[comment.post_id] ?? []), comment];
  }

  return grouped;
}

async function getScrapedPosts(profileId?: string): Promise<CommunityPostRecord[]> {
  if (!profileId) {
    return [];
  }
  const supabase = await createSupabaseServerClient();

  const { data } = await supabase
    .from("post_reactions")
    .select("post_id")
    .eq("user_id", profileId)
    .eq("type", "scrap");

  const postIds = (data ?? []).map((item) => item.post_id).filter(Boolean);
  if (!postIds.length) {
    return [];
  }

  const posts = await getPosts(profileId);
  const scrapedIds = new Set(postIds);
  return posts.filter((post) => scrapedIds.has(post.id));
}

async function getMyPosts(profileId?: string): Promise<CommunityPostRecord[]> {
  if (!profileId) return [];
  const posts = await getPosts(profileId);
  return posts.filter((post) => post.author_id === profileId);
}

async function getLikedPosts(profileId?: string): Promise<CommunityPostRecord[]> {
  if (!profileId) return [];
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("post_reactions").select("post_id").eq("user_id", profileId).eq("type", "like");
  const postIds = new Set((data ?? []).map(item => item.post_id));
  const posts = await getPosts(profileId);
  return posts.filter((post) => postIds.has(post.id));
}

async function getCommentedPosts(profileId?: string): Promise<CommunityPostRecord[]> {
  if (!profileId) return [];
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("comments").select("post_id").eq("author_id", profileId).eq("status", "active");
  const postIds = new Set((data ?? []).map(item => item.post_id));
  const posts = await getPosts(profileId);
  return posts.filter((post) => postIds.has(post.id));
}
