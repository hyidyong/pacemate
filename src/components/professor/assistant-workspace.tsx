import Link from "next/link";
import type { ProfessorCounselingRequest } from "@/services/professor.service";
import type { RoadmapRevisionRequest } from "@/services/roadmap-revisions.service";

/**
 * Codex round 5, F10 — the assistant workspace.
 *
 * `/professor` admits `["professor", "assistant"]`, and round 3 restored the
 * assistant's DATA scope: the service returns their university's counseling
 * workload with `professor: null`, because an assistant has no professors row
 * and borrowing one would be impersonation (KI-017 B-24).
 *
 * The page then rendered `data.professor ? <ProfessorWorkspace/> : <error>`, so
 * an authorized assistant was told "연결된 교수 정보를 찾지 못했습니다. 교수
 * 역할로 로그인해 주세요." — an instruction to log in as somebody else. The
 * service was right and the page was wrong; rendered QA is where that shows,
 * which is exactly why round 4 recorded rendered QA as UNVERIFIED.
 *
 * This is a SEPARATE view rather than the professor workspace with holes in it.
 * ProfessorWorkspace is built around `professor.id` — it stamps it into
 * availability writes, teaching-slot writes, FAQ writes and question replies.
 * Rendering it without one would either crash or need a fabricated identity,
 * and a fabricated identity is the bug this whole thread has been about.
 *
 * So the assistant sees exactly what the service scopes to them — the tenant's
 * counseling workload and curriculum revision queue — and the panels that
 * belong to one professor's own identity are absent rather than empty-and-
 * broken. Read-only: every mutating professor action takes a professorId this
 * account does not have.
 */

const STATUS_LABEL: Record<ProfessorCounselingRequest["status"], string> = {
  pending: "대기",
  approved: "승인",
  rejected: "반려",
  cancelled: "취소",
};

function formatSlot(startIso: string, endIso: string) {
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (Number.isNaN(start.getTime())) return "시간 미정";
  const date = start.toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" });
  const from = start.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
  const to = Number.isNaN(end.getTime())
    ? ""
    : ` – ${end.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}`;
  return `${date} ${from}${to}`;
}

export function AssistantWorkspace({
  schoolName,
  counselingRequests,
  roadmapRequests,
}: {
  schoolName: string | null;
  counselingRequests: ProfessorCounselingRequest[];
  roadmapRequests: RoadmapRevisionRequest[];
}) {
  const pending = counselingRequests.filter((request) => request.status === "pending");

  return (
    <div className="flex flex-col gap-6">
      <section className="section">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-bold text-lg text-slate-800 tracking-tight">조교 워크스페이스</h2>
          <p className="text-slate-500 text-sm">
            {schoolName ? `${schoolName} ` : ""}소속 교수님들의 상담 현황을 확인할 수 있습니다.
          </p>
        </div>
        <p className="mt-2 text-slate-500 text-sm">
          조교 계정에는 개별 교수 프로필·시간표·상담 가능 시간 설정이 표시되지 않습니다. 해당 항목은
          교수 본인 계정에서만 관리할 수 있습니다.
        </p>
      </section>

      <section className="section">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-semibold text-slate-800">상담 신청 현황</h3>
          <span className="text-slate-500 text-sm">
            전체 {counselingRequests.length}건 · 대기 {pending.length}건
          </span>
        </div>

        {counselingRequests.length === 0 ? (
          <div className="community-empty mt-3">
            <p>아직 접수된 상담 신청이 없습니다.</p>
          </div>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {counselingRequests.map((request) => (
              <li
                key={request.id}
                className="rounded-2xl border border-slate-200 bg-white px-4 py-3"
                data-status={request.status}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-slate-800">
                    {request.student?.name ?? "학생"}
                  </span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600 text-xs">
                    {STATUS_LABEL[request.status]}
                  </span>
                </div>
                <p className="mt-1 text-slate-600 text-sm">{request.topic}</p>
                <p className="mt-1 text-slate-500 text-xs">
                  {formatSlot(request.requested_start, request.requested_end)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="section">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-semibold text-slate-800">교육과정 수정 요청</h3>
          <span className="text-slate-500 text-sm">{roadmapRequests.length}건</span>
        </div>
        {roadmapRequests.length === 0 ? (
          <div className="community-empty mt-3">
            <p>검토할 수정 요청이 없습니다.</p>
          </div>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {roadmapRequests.map((request) => (
              <li key={request.id} className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                <p className="font-medium text-slate-800">{request.title}</p>
                {request.summary ? (
                  <p className="mt-1 text-slate-600 text-sm">{request.summary}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-slate-500 text-sm">
          승인·반려는 <Link href="/admin">관리자 페이지</Link>에서 처리합니다.
        </p>
      </section>
    </div>
  );
}
