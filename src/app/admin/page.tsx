import Link from "next/link";
import { ArrowLeft, CheckCircle2, ClipboardCheck, XCircle } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { NotificationStrip } from "@/components/notifications/notification-strip";
import { Button } from "@/components/ui/button";
import { updateRoadmapRevisionStatus } from "@/services/admin-approval.actions";
import { getAdminApprovalData } from "@/services/admin-approval.service";
import { getNotificationsForProfile } from "@/services/notifications.service";
import { requireRoles } from "@/services/role-guard.service";
import { getDemoProfile } from "@/services/session.service";

import { clearDemoSession } from "@/services/demo-auth.service";

export const dynamic = "force-dynamic";

export default async function AdminPage({
  searchParams,
}: {
  searchParams?: Promise<{ request?: string }>;
}) {
  const profile = await getDemoProfile();
  requireRoles(profile, ["assistant", "admin"]);
  const params = await searchParams;
  const selectedRequestId = params?.request;

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
                <small>{new Date(notification.created_at).toLocaleString("ko-KR")}</small>
              </Link>
            ))}
          </div>
        ) : (
          <div className="community-empty">
            <p>새 운영 문의가 없습니다.</p>
          </div>
        )}
      </section>

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
                <span>{request.status}</span>
                <strong>{request.title}</strong>
                <p>{request.summary}</p>
              </article>
            ))}
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
              <button className="button button-default button-md" type="submit">
                {actionLabel}
                {icon}
              </button>
            </form>
            {secondaryStatus ? (
              <form action={updateRoadmapRevisionStatus}>
                <input name="requestId" type="hidden" value={request.id} />
                <input name="status" type="hidden" value={secondaryStatus} />
                <button className="admin-reject-button" type="submit">
                  반려
                  <XCircle size={15} aria-hidden="true" />
                </button>
              </form>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}
