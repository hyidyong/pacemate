"use client";

import { useActionState } from "react";
import { BellRing } from "lucide-react";
import { sendAdminBroadcastNotification } from "@/services/admin-notifications.actions";

const initialState = { ok: false, message: "" };

export function AdminNotificationConsole() {
  const [state, formAction, pending] = useActionState(sendAdminBroadcastNotification, initialState);

  return (
    <section className="mt-8 rounded-3xl bg-slate-50 p-6 shadow-sm sm:p-8">
      <div className="mb-6 flex items-start gap-3">
        <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-rose-100 text-rose-500">
          <BellRing size={21} aria-hidden="true" />
        </span>
        <div>
          <h2 className="text-lg font-bold text-slate-900">공지/알림 관리</h2>
          <p className="mt-1 text-sm text-slate-500">선택한 그룹의 앱 내 알림 센터와 실시간 토스트에 즉시 전달됩니다.</p>
        </div>
      </div>
      <form action={formAction} className="grid gap-4">
        <label className="grid gap-2 text-sm font-semibold text-slate-700">
          수신 대상
          <select name="targetGroup" defaultValue="ALL" className="rounded-2xl bg-white px-4 py-3 text-sm shadow-sm outline-none ring-0 focus:ring-2 focus:ring-rose-200">
            <option value="ALL">전체 유저</option>
            <option value="STUDENT">학생만</option>
            <option value="PROFESSOR">교수만</option>
          </select>
        </label>
        <label className="grid gap-2 text-sm font-semibold text-slate-700">
          제목
          <input name="title" maxLength={120} required className="rounded-2xl bg-white px-4 py-3 text-sm shadow-sm outline-none focus:ring-2 focus:ring-rose-200" placeholder="예: 서비스 점검 안내" />
        </label>
        <label className="grid gap-2 text-sm font-semibold text-slate-700">
          내용
          <textarea name="content" maxLength={1000} required rows={4} className="resize-y rounded-2xl bg-white px-4 py-3 text-sm shadow-sm outline-none focus:ring-2 focus:ring-rose-200" placeholder="수신자에게 전달할 내용을 입력해 주세요." />
        </label>
        {state.message ? <p className={state.ok ? "text-sm text-emerald-700" : "text-sm text-rose-600"} role="status">{state.message}</p> : null}
        <button disabled={pending} className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-rose-500 px-5 py-3 text-sm font-bold text-white shadow-md transition hover:bg-rose-600 disabled:bg-slate-300" type="submit">
          <BellRing size={17} aria-hidden="true" />
          {pending ? "발송 중..." : "알림 푸시하기"}
        </button>
      </form>
    </section>
  );
}
