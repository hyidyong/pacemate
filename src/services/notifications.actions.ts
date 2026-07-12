"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { normalizeUuid } from "@/lib/uuid";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getDemoProfile } from "@/services/session.service";

function text(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

function safeNotificationTargetHref(value: unknown): string {
  if (typeof value !== "string") {
    return "/notifications";
  }

  const targetHref = value.trim();
  const hasInternalPathShape = targetHref.startsWith("/") && !targetHref.startsWith("//");
  const hasForbiddenScheme = /[a-z][a-z\d+.-]*:/i.test(targetHref);

  if (!hasInternalPathShape || targetHref.includes("\\") || hasForbiddenScheme) {
    return "/notifications";
  }

  return targetHref;
}

function notificationOwnershipFilter(profile: NonNullable<Awaited<ReturnType<typeof getDemoProfile>>>) {
  return `recipient_id.eq.${profile.id},recipient_role.eq.${profile.role}`;
}

export async function markNotificationReadAndGo(formData: FormData) {
  const profile = await getDemoProfile();
  const notificationId = normalizeUuid(text(formData.get("notificationId")));

  if (!profile || !notificationId) {
    redirect("/notifications");
  }

  const supabase = await createSupabaseServerClient();
  const ownershipFilter = notificationOwnershipFilter(profile);
  const { data: notification, error: selectError } = await supabase
    .from("user_notifications")
    .select("target_href")
    .eq("id", notificationId)
    .or(ownershipFilter)
    .maybeSingle();

  if (selectError || !notification) {
    redirect("/notifications");
  }

  const { error: updateError } = await supabase
    .from("user_notifications")
    .update({ is_read: true })
    .eq("id", notificationId)
    .or(ownershipFilter);

  if (updateError) {
    redirect("/notifications");
  }

  revalidatePath("/notifications");
  redirect(safeNotificationTargetHref(notification.target_href));
}

export async function markNotificationAsRead(notificationId: string) {
  const profile = await getDemoProfile();
  const normalizedNotificationId = normalizeUuid(notificationId);

  if (!profile || !normalizedNotificationId) {
    return;
  }

  const supabase = await createSupabaseServerClient();
  await supabase
    .from("user_notifications")
    .update({ is_read: true })
    .eq("id", normalizedNotificationId)
    .or(notificationOwnershipFilter(profile));

  revalidatePath("/notifications");
  revalidatePath("/dashboard");
}

export async function markAllNotificationsRead() {
  const profile = await getDemoProfile();
  if (!profile) {
    return;
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("user_notifications")
    .update({ is_read: true })
    .eq("is_read", false)
    .or(notificationOwnershipFilter(profile));

  if (error) {
    return;
  }

  revalidatePath("/notifications");
  revalidatePath("/dashboard");
  revalidatePath("/professor");
}
