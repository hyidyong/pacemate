import Link from "next/link";
import { ArrowLeft, CheckCircle2, ClipboardCheck, XCircle } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { NotificationStrip } from "@/components/notifications/notification-strip";
import { AdminNotificationConsole } from "@/components/admin/admin-notification-console";
import { Button } from "@/components/ui/button";
import { PendingSubmitButton } from "@/components/ui/pending-submit-button";
import { updateRoadmapRevisionStatus } from "@/services/admin-approval.actions";
import { getAdminApprovalData } from "@/services/admin-approval.service";
import { getNotificationsForProfile } from "@/services/notifications.service";
import { requireRoles } from "@/services/role-guard.service";
import { getDemoProfile } from "@/services/session.service";

import { clearDemoSession } from "@/services/demo-auth.service";

export const dynamic = "force-dynamic";

// Board actions redirect back with a result code — the old void action gave
// no feedback for success OR failure (Stage 4, audit B-42).
const resultMessages: Record<string, { text: string; ok: boolean }> = {
  assistant_reviewed: { text: "조교 1차 검토를 완료했습니다.", ok: true },
  approved: { text: "최종 승인했습니다. 학생 로드맵에 반영됩니다.", ok: true },
  rejected: { text: "요청을 반려하고 요청자에게 알림을 보냈습니다.", ok: true },
  note_required: { text: "반려하려면 검토 메모에 반려 사유를 입력해 주세요.", ok: false },
  invalid: { text: "요청을 처리할 수 없습니다. 다시 시도해 주세요.", ok: false },
  error: { text: "처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.", ok: false },
};

const completedStatusLabels: Record<string, string> = {
  approved: "승인 완료",
  rejected: "반려",
  assistant_reviewed: "조교 검토 완료",
  pending: "대기",
};

export default async function AdminPage({
  searchParams,
}: {
  searchParams?: Promise<{ request?: string; result?: string }>;
}) {
  const profile = await getDemoProfile();
  requireRoles(profile, ["assistant", "admin"]);
  const params = await searchParams;
  const selectedRequestId = params?.request;
  const result = params?.result ? resultMessages[params.result] ?? null : null;

  const [data, notifications, supportNotifications] = await Promise.all([
    getAdminApprovalData(),
    getNotificationsForProfile(profile, 4),
    getNotificationsForProfile(profile, 6, "system"),
  ]);

  return (
    <AppShell>
      <section className="screen-hero">
        <Link href="/dashboard" className="status-line">
          <ArrowLeft size={15} aria-hidden="true" />
          운영 승인 센터
        </Link>
        <h1>로드맵 수정 승인</h1>
        <p>
          교수 수정 요청을 조교가 먼저 검토하고, 관리자가 최종 승인하면 학생
          로드맵에 바로 반영됩니다.
        </p>
        <div className="actions">
          <Button asChild variant="outline">
            <Link href="/roadmap">학생 로드맵 확인</Link>
          </Button>
        </div>
      </section>

      <NotificationStrip notifications={notifications} />

      {profile?.role === "admin" ? <AdminNotificationConsole /> : null}

      <section className="section admin-support-panel">
        <div className="community-section-heading">
          <h2>운영 문의</h2>
          <span>{supportNotifications.length}건</span>
        </div>
        {supportNotifications.length ? (
          <div className="admin-support-list">
            {supportNotifications.map((notification) => (
              <Link href={notification.target_href} key={notification.id}>
                <strong>{notification.title}</strong>
                <p>{notification.body}</p>
                <small>{new Date(notification.created_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</small>
              </Link>
            ))}
          </div>
        ) : (
          <div className="community-empty">
            <p>새 운영 문의가 없습니다.</p>
          </div>
        )}
      </section>

      {result ? (
        <section className="section">
          <p
            className={`rounded-xl border px-4 py-3 text-sm font-medium ${
              result.ok
                ? "border-emerald-100 bg-emerald-50 text-emerald-700"
                : "border-red-100 bg-red-50 text-red-600"
            }`}
            role={result.ok ? "status" : "alert"}
          >
            {result.text}
          </p>
        </section>
      ) : null}

      <section className="section admin-approval-board">
        <ApprovalColumn
          actionLabel="조교 1차 검토"
          icon={<ClipboardCheck aria-hidden="true" />}
          requests={data.pending}
          selectedRequestId={selectedRequestId}
          status="assistant_reviewed"
          title="검수 대기"
        />
        <ApprovalColumn
          actionLabel="최종 승인"
          icon={<CheckCircle2 aria-hidden="true" />}
          requests={data.reviewed}
          secondaryStatus="rejected"
          selectedRequestId={selectedRequestId}
          status="approved"
          title="최종 승인 대기"
        />
        <section className="admin-approval-column">
          <div className="community-section-heading">
            <h2>처리 완료</h2>
            <span>{data.completed.length}건</span>
          </div>
          <div className="admin-request-list">
            {data.completed.map((request) => (
              <article data-selected={selectedRequestId === request.id} key={request.id}>
                <span>{completedStatusLabels[request.status] ?? request.status}</span>
                <strong>{request.title}</strong>
                <p>{request.summary}</p>
              </article>
            ))}
            {data.completed.length === 0 ? (
              <div className="community-empty">
                <p>처리 완료된 요청이 없습니다.</p>
              </div>
            ) : null}
          </div>
        </section>
      </section>

      <section className="section flex justify-center mt-8 mb-12">
        <form action={clearDemoSession} className="w-full max-w-[200px]">
          <Button type="submit" variant="outline" className="w-full border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700">
            로그아웃
          </Button>
        </form>
      </section>
    </AppShell>
  );
}

function ApprovalColumn({
  actionLabel,
  icon,
  requests,
  secondaryStatus,
  selectedRequestId,
  status,
  title,
}: {
  actionLabel: string;
  icon: React.ReactNode;
  requests: Awaited<ReturnType<typeof getAdminApprovalData>>["pending"];
  secondaryStatus?: "rejected";
  selectedRequestId?: string;
  status: "assistant_reviewed" | "approved";
  title: string;
}) {
  return (
    <section className="admin-approval-column">
      <div className="community-section-heading">
        <h2>{title}</h2>
        <span>{requests.length}건</span>
      </div>
      <div className="admin-request-list">
        {requests.map((request) => (
          <article data-selected={selectedRequestId === request.id} key={request.id}>
            <span>{request.scope === "department" ? "학과 전체" : request.course_code}</span>
            <strong>{request.title}</strong>
            <p>{request.summary}</p>
            <p>
              출처: {request.source_title ?? "직접 입력"} · 요청자:{" "}
              {request.proposed_by_name}
            </p>
            <form action={updateRoadmapRevisionStatus} className="admin-approval-form">
              <input name="requestId" type="hidden" value={request.id} />
              <input name="status" type="hidden" value={status} />
              <label className="field">
                <span>검토 메모</span>
                <input name="adminNote" placeholder="검토 의견을 남길 수 있어요" />
              </label>
              <PendingSubmitButton pendingLabel="처리 중…">
                {actionLabel}
                {icon}
              </PendingSubmitButton>
            </form>
            {secondaryStatus ? (
              <form action={updateRoadmapRevisionStatus} className="admin-approval-form">
                <input name="requestId" type="hidden" value={request.id} />
                <input name="status" type="hidden" value={secondaryStatus} />
                <label className="field">
                  <span>반려 사유 (필수 · 요청자에게 전달됩니다)</span>
                  <input name="adminNote" placeholder="반려 사유를 입력해 주세요" required />
                </label>
                <button className="admin-reject-button" type="submit">
                  반려
                  <XCircle size={15} aria-hidden="true" />
                </button>
              </form>
            ) : null}
          </article>
        ))}
        {requests.length === 0 ? (
          <div className="community-empty">
            <p>{title} 요청이 없습니다.</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
