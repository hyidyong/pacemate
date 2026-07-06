"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { getDemoProfile } from "@/services/session.service";

function text(value: FormDataEntryValue | null, fallback = "") {
  const current = typeof value === "string" ? value.trim() : "";
  return current || fallback;
}

export async function markNotificationReadAndGo(formData: FormData) {
  const notificationId = text(formData.get("notificationId"));
  const targetHref = text(formData.get("targetHref"), "/notifications");

  if (notificationId) {
    await supabase
      .from("user_notifications")
      .update({ is_read: true })
      .eq("id", notificationId);
  }

  revalidatePath("/notifications");
  redirect(targetHref);
}

export async function markAllNotificationsRead() {
  const profile = await getDemoProfile();
  if (!profile) {
    return;
  }

  let query = supabase
    .from("user_notifications")
    .update({ is_read: true })
    .eq("is_read", false);

  query = query.or(`recipient_role.eq.${profile.role},recipient_id.eq.${profile.id}`);

  const { error } = await query;

  if (error) {
    return;
  }

  revalidatePath("/notifications");
  revalidatePath("/dashboard");
  revalidatePath("/professor");
}
