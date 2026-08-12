// KI-003: page-level fetch failures were swallowed into default/empty data,
// rendering exactly like a brand-new account. Pages that catch a read error
// render this notice above the (empty) content so failure and emptiness are
// distinguishable, with a same-URL retry.
export function DataErrorNotice({ label }: { label?: string }) {
  return (
    <div
      className="mx-auto mb-4 w-full rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
      role="alert"
    >
      <p className="font-semibold">{label ?? "일부 데이터를 불러오지 못했습니다."}</p>
      <p className="mt-1">
        표시된 내용이 실제와 다를 수 있습니다.{" "}
        <a className="font-semibold underline underline-offset-2" href="">
          새로고침
        </a>
        해 주세요.
      </p>
    </div>
  );
}
