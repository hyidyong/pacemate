export const browserNotificationCategories = ["question", "counseling", "revision", "system"] as const;
export type BrowserNotificationCategory = (typeof browserNotificationCategories)[number];

export type BrowserNotificationPreferences = {
  browserEnabled: boolean;
  categories: BrowserNotificationCategory[];
  quietStart: string;
  quietEnd: string;
};

const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export function normalizeNotificationPreferences(value: unknown): BrowserNotificationPreferences {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const categories = Array.isArray(input.categories)
    ? input.categories.filter((item): item is BrowserNotificationCategory =>
        browserNotificationCategories.includes(item as BrowserNotificationCategory))
    : [];
  return {
    browserEnabled: input.browserEnabled === true,
    categories: [...new Set(categories)],
    quietStart: typeof input.quietStart === "string" && TIME_PATTERN.test(input.quietStart) ? input.quietStart : "22:00",
    quietEnd: typeof input.quietEnd === "string" && TIME_PATTERN.test(input.quietEnd) ? input.quietEnd : "07:00",
  };
}

export function isWithinQuietHours(current: string, start: string, end: string) {
  if (![current, start, end].every((value) => TIME_PATTERN.test(value))) return true;
  if (start === end) return false;
  return start < end ? current >= start && current < end : current >= start || current < end;
}
