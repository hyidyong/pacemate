"use client";

import { useMemo, useState, useTransition } from "react";
import { Check, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { generateStudentPersonalizedRoadmap } from "@/services/student-roadmap.actions";

type Offering = { offeringId: string; courseId: string; courseName: string };
type Week = { week_number: number; baseline_title: string; baseline_topic: string; baseline_content: string; personalized_goal: string; learning_activities: unknown; review_guide: string };

export function StudentRoadmapWorkspace({ offerings, initialWeeks, completedWeeks }: { offerings: Offering[]; initialWeeks: Week[]; completedWeeks: number[] }) {
  const router = useRouter(); const [offeringId, setOfferingId] = useState(offerings[0]?.offeringId ?? ""); const [activeWeek, setActiveWeek] = useState(1); const [isPending, startTransition] = useTransition();
  const week = useMemo(() => initialWeeks.find((item) => item.week_number === activeWeek), [activeWeek, initialWeeks]);
  if (!offerings.length) return <section className="rounded-2xl bg-slate-50 p-8 text-center text-slate-500 shadow-sm">시간표에 추가된 과목이 없습니다.</section>;
  return <section className="rounded-3xl bg-white p-5 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-semibold text-emerald-700">과목별 로드맵</p><select className="mt-2 rounded-xl bg-slate-50 px-3 py-2 text-sm" onChange={(event) => { setOfferingId(event.target.value); setActiveWeek(1); router.refresh(); }} value={offeringId}>{offerings.map((item) => <option key={item.offeringId} value={item.offeringId}>{item.courseName}</option>)}</select></div><button className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm" disabled={isPending} onClick={() => startTransition(async () => { await generateStudentPersonalizedRoadmap(offeringId); router.refresh(); })} type="button"><Sparkles size={16}/>로드맵 생성 / 업데이트</button></div><div className="mt-5 flex gap-2 overflow-x-auto pb-1">{Array.from({ length: 15 }, (_, index) => index + 1).map((number) => { const completed = completedWeeks.includes(number); return <button className={`h-9 w-9 shrink-0 rounded-full text-sm font-semibold ${number === activeWeek ? "bg-blue-50 text-blue-600 shadow-sm" : completed ? "bg-green-50 text-green-600" : "bg-gray-100 text-gray-500"}`} key={number} onClick={() => setActiveWeek(number)} type="button">{completed ? <Check className="mx-auto" size={15}/> : number}</button>; })}</div>{week ? <article className="mt-5 rounded-2xl bg-slate-50 p-5 shadow-sm"><p className="text-sm font-bold text-slate-900">{week.week_number}주차 · {week.baseline_title}</p><p className="mt-2 text-sm text-slate-600">{week.personalized_goal}</p><p className="mt-3 text-xs leading-5 text-slate-500">{week.review_guide}</p></article> : <div className="mt-5 rounded-2xl bg-slate-50 p-6 text-sm text-slate-500">로드맵 생성 버튼을 눌러 개인화 계획을 생성하세요.</div>}</section>;
}
