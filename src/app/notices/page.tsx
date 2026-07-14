import Link from "next/link";
import { AppShell } from "@/components/layout/app-shell";
import { listStudentCourseNotices } from "@/services/course-notices.server";
import { getDemoProfile } from "@/services/session.service";

export const dynamic = "force-dynamic";

export default async function NoticesPage() {
  const profile = await getDemoProfile();
  const notices = profile?.role === "student" ? await listStudentCourseNotices(profile.id) : [];
  return <AppShell><section className="mx-auto w-full max-w-3xl px-4 py-8"><h1 className="text-2xl font-bold text-slate-900">공지사항</h1><p className="mt-2 text-sm text-slate-500">수강 중인 과목의 최신 공지입니다.</p><div className="mt-6 space-y-3">{notices.map((notice) => <Link className="block rounded-2xl bg-white p-5 shadow-sm transition hover:bg-slate-50" href={notice.href} key={notice.id}><p className="text-sm font-bold text-slate-900">{notice.title}</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-600">{notice.content}</p><p className="mt-3 text-xs font-medium text-emerald-700">{notice.courseName ?? "과목 공지"}</p></Link>)}{!notices.length ? <div className="rounded-2xl bg-slate-50 p-8 text-center text-sm text-slate-500 shadow-sm">확인할 공지사항이 없습니다.</div> : null}</div></section></AppShell>;
}
