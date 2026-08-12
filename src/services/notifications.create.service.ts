import "server-only";

import { normalizeUuid } from "@/lib/uuid";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";

const NOTIFICATION_CATEGORIES = [
  "question",
  "counseling",
  "revision",
  "system",
] as const;

const NOTIFICATION_RECIPIENT_ROLES = [
  "student",
  "professor",
  "assistant",
  "admin",
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];
export type NotificationRecipientRole = (typeof NOTIFICATION_RECIPIENT_ROLES)[number] | null;

export type UserNotificationCreateInput = {
  category: NotificationCategory;
  recipientRole: NotificationRecipientRole;
  recipientId: string | null;
  title: string;
  body: string;
  targetHref: string;
  // Stage 6: the tenant this notification belongs to. Optional — when omitted
  // for a recipient-addressed notification it is resolved from the recipient's
  // profile; a broadcast (no recipient) should pass it explicitly. Left null
  // only for legacy/ungated writers (Stage 9).
  schoolId?: string | null;
};

export type NotificationCreateResult =
  | { ok: true }
  | { ok: false; message: string };

const INVALID_NOTIFICATION_MESSAGE = "알림 정보를 확인해 주세요.";
const NOTIFICATION_CREATE_FAILED_MESSAGE = "알림을 만들지 못했습니다.";

function isNotificationCategory(value: string): value is NotificationCategory {
  return NOTIFICATION_CATEGORIES.includes(value as NotificationCategory);
}

function isNotificationRecipientRole(value: string): value is Exclude<NotificationRecipientRole, null> {
  return NOTIFICATION_RECIPIENT_ROLES.includes(value as Exclude<NotificationRecipientRole, null>);
}

function isInternalNotificationPath(value: string): boolean {
  return (
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.includes("\\") &&
    !/[a-z][a-z\d+.-]*:/i.test(value)
  );
}

function normalizeNotificationInput(
  input: UserNotificationCreateInput,
): UserNotificationCreateInput | null {
  if (!isNotificationCategory(input.category)) {
    return null;
  }

  if (input.recipientRole !== null && !isNotificationRecipientRole(input.recipientRole)) {
    return null;
  }

  let recipientId: string | null = null;
  if (input.recipientId !== null) {
    recipientId = normalizeUuid(input.recipientId);
    if (!recipientId) {
      return null;
    }
  }

  const title = input.title.trim();
  const body = input.body.trim();
  const targetHref = input.targetHref.trim();

  if (
    (input.recipientRole === null && recipientId === null) ||
    !title ||
    !body ||
    !isInternalNotificationPath(targetHref)
  ) {
    return null;
  }

  return {
    category: input.category,
    recipientRole: input.recipientRole,
    recipientId,
    title,
    body,
    targetHref,
    schoolId: input.schoolId ?? null,
  };
}

function toDatabaseNotification(
  input: UserNotificationCreateInput,
  schoolId: string | null,
) {
  return {
    recipient_role: input.recipientRole,
    recipient_id: input.recipientId,
    category: input.category,
    title: input.title,
    body: input.body,
    target_href: input.targetHref,
    school_id: schoolId,
  };
}

// Stage 6: stamp the tenant on every notification. An explicit schoolId wins;
// otherwise a recipient-addressed notification inherits its recipient's tenant
// (one batched lookup). A broadcast with no explicit tenant is left null
// (legacy/ungated writer — Stage 9). Never blocks notification creation.
async function resolveSchoolIds(
  supabase: SupabaseClient,
  inputs: readonly UserNotificationCreateInput[],
): Promise<(string | null)[]> {
  const missing = Array.from(
    new Set(
      inputs
        .filter((input) => !input.schoolId && input.recipientId)
        .map((input) => input.recipientId as string),
    ),
  );

  const schoolByProfile = new Map<string, string | null>();
  if (missing.length) {
    const { data } = await supabase
      .from("profiles")
      .select("id, school_id")
      .in("id", missing);
    for (const row of data ?? []) {
      schoolByProfile.set(row.id as string, (row.school_id as string | null) ?? null);
    }
  }

  return inputs.map(
    (input) =>
      input.schoolId ??
      (input.recipientId ? schoolByProfile.get(input.recipientId) ?? null : null),
  );
}

export async function createUserNotification(
  input: UserNotificationCreateInput,
): Promise<NotificationCreateResult> {
  return createUserNotifications([input]);
}

export async function createUserNotifications(
  inputs: readonly UserNotificationCreateInput[],
): Promise<NotificationCreateResult> {
  const supabase = await createSupabaseServerClient();
  return createUserNotificationsWithClient(supabase, inputs);
}

export async function createUserNotificationsWithClient(
  supabase: SupabaseClient,
  inputs: readonly UserNotificationCreateInput[],
): Promise<NotificationCreateResult> {
  if (inputs.length === 0) {
    return { ok: false, message: INVALID_NOTIFICATION_MESSAGE };
  }

  const normalizedInputs: UserNotificationCreateInput[] = [];
  for (const input of inputs) {
    const normalizedInput = normalizeNotificationInput(input);
    if (!normalizedInput) {
      return { ok: false, message: INVALID_NOTIFICATION_MESSAGE };
    }

    normalizedInputs.push(normalizedInput);
  }

  try {
    const schoolIds = await resolveSchoolIds(supabase, normalizedInputs);
    const { error } = await supabase
      .from("user_notifications")
      .insert(normalizedInputs.map((input, index) => toDatabaseNotification(input, schoolIds[index])));

    if (error) {
      return { ok: false, message: NOTIFICATION_CREATE_FAILED_MESSAGE };
    }

    return { ok: true };
  } catch {
    return { ok: false, message: NOTIFICATION_CREATE_FAILED_MESSAGE };
  }
}
