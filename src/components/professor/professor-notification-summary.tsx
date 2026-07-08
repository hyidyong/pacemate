import Link from "next/link";
import { Bell } from "lucide-react";

type ProfessorNotificationSummaryProps = {
  counselingCount: number;
  questionCount: number;
};

export function ProfessorNotificationSummary({
  counselingCount,
  questionCount,
}: ProfessorNotificationSummaryProps) {
  if (!counselingCount && !questionCount) {
    return null;
  }

  return (
    <section className="section notification-summary" aria-label="알림 요약">
      <div className="notification-summary-chips" style={{ display: "flex", gap: "12px", alignItems: "center", padding: "16px", backgroundColor: "var(--color-bg-elevated)", borderRadius: "var(--radius-lg)" }}>
        <Bell size={20} className="text-muted" aria-hidden="true" />

        {counselingCount > 0 && (
          <Link href="/professor?tab=counseling&sub=pending-counseling" className="chip chip-counseling" style={{ padding: "6px 12px", backgroundColor: "var(--color-tone-urgent-bg, #ffebee)", color: "var(--color-tone-urgent-fg, #c62828)", borderRadius: "999px", fontSize: "14px", fontWeight: "600", textDecoration: "none" }}>
            상담 요청 {counselingCount}건
          </Link>
        )}

        {questionCount > 0 && (
          <Link href="/professor?tab=questions&sub=incoming-questions" className="chip chip-question" style={{ padding: "6px 12px", backgroundColor: "var(--color-tone-calm-bg, #e8f5e9)", color: "var(--color-tone-calm-fg, #2e7d32)", borderRadius: "999px", fontSize: "14px", fontWeight: "600", textDecoration: "none" }}>
            질문 요청 {questionCount}건
          </Link>
        )}

        {counselingCount === 0 && questionCount === 0 && (
          <span style={{ fontSize: "14px", color: "var(--color-text-muted)" }}>새로운 상담 또는 질문 요청이 없습니다.</span>
        )}
      </div>
    </section>
  );
}
