import Link from "next/link";
import { Bell } from "lucide-react";
import type { UserNotification } from "@/services/notifications.service";

type ProfessorNotificationSummaryProps = {
  notifications: UserNotification[];
};

export function ProfessorNotificationSummary({
  notifications,
}: ProfessorNotificationSummaryProps) {
  if (!notifications.length) {
    return null;
  }

  // Calculate counts for chips
  const counselingCount = notifications.filter((n) => n.category === "counseling").length;
  const revisionCount = notifications.filter((n) => n.category === "revision").length;
  const questionCount = notifications.filter((n) => n.category === "question").length;

  return (
    <section className="section notification-summary" aria-label="알림 요약">
      <div className="notification-summary-chips" style={{ display: "flex", gap: "12px", alignItems: "center", padding: "16px", backgroundColor: "var(--color-bg-elevated)", borderRadius: "var(--radius-lg)" }}>
        <Bell size={20} className="text-muted" aria-hidden="true" />
        
        {counselingCount > 0 && (
          <Link href="/professor?tab=counseling" className="chip chip-counseling" style={{ padding: "6px 12px", backgroundColor: "var(--color-tone-urgent-bg, #ffebee)", color: "var(--color-tone-urgent-fg, #c62828)", borderRadius: "999px", fontSize: "14px", fontWeight: "600", textDecoration: "none" }}>
            새 상담 신청 {counselingCount}건
          </Link>
        )}
        
        {revisionCount > 0 && (
          <Link href="/professor?tab=roadmap" className="chip chip-revision" style={{ padding: "6px 12px", backgroundColor: "var(--color-tone-normal-bg, #e3f2fd)", color: "var(--color-tone-normal-fg, #1565c0)", borderRadius: "999px", fontSize: "14px", fontWeight: "600", textDecoration: "none" }}>
            수정 요청 {revisionCount}건
          </Link>
        )}

        {questionCount > 0 && (
          <Link href="/professor?tab=questions" className="chip chip-question" style={{ padding: "6px 12px", backgroundColor: "var(--color-tone-calm-bg, #e8f5e9)", color: "var(--color-tone-calm-fg, #2e7d32)", borderRadius: "999px", fontSize: "14px", fontWeight: "600", textDecoration: "none" }}>
            새 질문 {questionCount}건
          </Link>
        )}

        {counselingCount === 0 && revisionCount === 0 && questionCount === 0 && (
          <span style={{ fontSize: "14px", color: "var(--color-text-muted)" }}>기타 알림 {notifications.length}건</span>
        )}
      </div>
    </section>
  );
}
