import { supabase } from "@/lib/supabase/client";
import type { DemoProfile } from "@/services/session.service";

export type UserNotification = {
  id: string;
  recipient_role: DemoProfile["role"] | null;
  category: "question" | "counseling" | "revision" | "system";
  title: string;
  body: string;
  target_href: string;
  is_read: boolean;
  created_at: string;
};

export type NotificationCategoryFilter = UserNotification["category"] | "all";

export const notificationCategoryLabels: Record<NotificationCategoryFilter, string> = {
  all: "전체",
  question: "질문",
  counseling: "상담",
  revision: "로드맵",
  system: "문의",
};

export async function getNotificationsForProfile(
  profile: DemoProfile | null,
  limit = 5,
  category: NotificationCategoryFilter = "all",
): Promise<UserNotification[]> {
  if (!profile) {
    return [];
  }

  let query = supabase
    .from("user_notifications")
    .select("id, recipient_role, category, title, body, target_href, is_read, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  query = query.or(`recipient_role.eq.${profile.role},recipient_id.eq.${profile.id}`);

  if (category !== "all") {
    query = query.eq("category", category);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to load notifications: ${error.message}`);
  }

  return (data ?? []) as UserNotification[];
}

export async function getUnreadNotificationCount(profile: DemoProfile | null) {
  if (!profile) {
    return 0;
  }

  let query = supabase
    .from("user_notifications")
    .select("id", { count: "exact", head: true })
    .eq("is_read", false);

  query = query.or(`recipient_role.eq.${profile.role},recipient_id.eq.${profile.id}`);

  const { count, error } = await query;

  if (error) {
    throw new Error(`Failed to load unread notification count: ${error.message}`);
  }

  return count ?? 0;
}

export async function getUnreadNotificationCountByCategory(
  profile: DemoProfile | null,
  category: UserNotification["category"],
) {
  if (!profile) {
    return 0;
  }

  let query = supabase
    .from("user_notifications")
    .select("id", { count: "exact", head: true })
    .eq("is_read", false)
    .eq("category", category);

  query = query.or(`recipient_role.eq.${profile.role},recipient_id.eq.${profile.id}`);

  const { count, error } = await query;

  if (error) {
    throw new Error(`Failed to load unread notification count for ${category}: ${error.message}`);
  }

  return count ?? 0;
}
