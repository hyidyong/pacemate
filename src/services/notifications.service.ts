import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
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

const notificationCategories: readonly UserNotification["category"][] = [
  "question",
  "counseling",
  "revision",
  "system",
];

function isNotificationCategory(value: string): value is UserNotification["category"] {
  return notificationCategories.includes(value as UserNotification["category"]);
}

function normalizeNotificationLimit(limit: number): number {
  if (!Number.isFinite(limit)) {
    return 5;
  }

  return Math.min(100, Math.max(1, Math.trunc(limit)));
}

const NOTIFICATION_READ_ERROR = "알림을 불러오지 못했습니다.";

function applyNotificationOwnership<T>(query: T, profile: DemoProfile) {
  return (query as { or: (filters: string) => T }).or(
    `recipient_id.eq.${profile.id},recipient_role.eq.${profile.role}`,
  );
}

export async function getNotificationsForProfile(
  profile: DemoProfile | null,
  limit = 5,
  category: NotificationCategoryFilter = "all",
): Promise<UserNotification[]> {
  if (!profile) {
    return [];
  }

  if (category !== "all" && !isNotificationCategory(category)) {
    return [];
  }

  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("user_notifications")
    .select("id, recipient_role, category, title, body, target_href, is_read, created_at")
    .order("created_at", { ascending: false })
    .limit(normalizeNotificationLimit(limit));

  query = applyNotificationOwnership(query, profile);

  if (category !== "all") {
    query = query.eq("category", category);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(NOTIFICATION_READ_ERROR);
  }

  return (data ?? []) as UserNotification[];
}

export async function getUnreadNotificationCount(profile: DemoProfile | null) {
  if (!profile) {
    return 0;
  }

  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("user_notifications")
    .select("id", { count: "exact", head: true })
    .eq("is_read", false);

  query = applyNotificationOwnership(query, profile);

  const { count, error } = await query;

  if (error) {
    throw new Error(NOTIFICATION_READ_ERROR);
  }

  return count ?? 0;
}

export async function getUnreadNotificationCountByCategory(
  profile: DemoProfile | null,
  category: UserNotification["category"],
) {
  if (!profile || !isNotificationCategory(category)) {
    return 0;
  }

  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("user_notifications")
    .select("id", { count: "exact", head: true })
    .eq("is_read", false)
    .eq("category", category);

  query = applyNotificationOwnership(query, profile);

  const { count, error } = await query;

  if (error) {
    throw new Error(NOTIFICATION_READ_ERROR);
  }

  return count ?? 0;
}
