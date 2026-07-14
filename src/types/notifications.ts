export type NotificationRecipientRole =
  | "student"
  | "professor"
  | "assistant"
  | "admin";

export type NotificationTargetGroup = "ALL" | "STUDENT" | "PROFESSOR";

export type UserNotification = {
  id: string;
  recipient_role: NotificationRecipientRole | null;
  target_group: NotificationTargetGroup;
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
