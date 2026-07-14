"use client";

import { useEffect } from "react";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Unhandled route error", error);
  }, [error]);

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-slate-50 px-5 text-center">
      <section className="w-full max-w-sm rounded-3xl bg-white p-7 shadow-sm">
        <h1 className="text-xl font-bold text-slate-900">페이지를 불러오지 못했습니다</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          잠시 후 다시 시도해 주세요. 문제가 계속되면 다시 로그인해 주세요.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <button
            className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white"
            onClick={() => reset()}
            type="button"
          >
            다시 시도
          </button>
          <a
            className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700"
            href="/login"
          >
            로그인
          </a>
        </div>
      </section>
    </main>
  );
}
