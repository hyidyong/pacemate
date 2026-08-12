// Neutral route-level loading skeleton (Stage 4, KI-016 loading backlog).
// Every route was force-dynamic with no loading.tsx: a navigation gave zero
// visual feedback until the full SSR payload arrived (268-852 ms measured in
// Stage 3). This renders instantly from the static shell while the page
// streams. Deliberately generic — no fake content, no layout claims beyond
// "title, then cards".
export function RouteSkeleton({ cards = 3 }: { cards?: number }) {
  return (
    <div aria-hidden="true" className="mx-auto w-full max-w-6xl animate-pulse px-4 py-8 sm:px-6">
      <div className="h-8 w-48 rounded-lg bg-slate-200/70" />
      <div className="mt-3 h-4 w-72 max-w-full rounded bg-slate-100" />
      <div className="mt-8 space-y-5">
        {Array.from({ length: cards }, (_, index) => (
          <div key={index} className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
            <div className="h-5 w-40 rounded bg-slate-200/70" />
            <div className="mt-4 h-4 w-full rounded bg-slate-100" />
            <div className="mt-2 h-4 w-2/3 rounded bg-slate-100" />
          </div>
        ))}
      </div>
      <p className="sr-only" role="status">
        불러오는 중
      </p>
    </div>
  );
}
