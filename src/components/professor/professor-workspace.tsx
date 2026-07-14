"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  BookOpenText,
  BarChart3,
  CalendarClock,
  Check,
  Clock,
  FileText,
  GraduationCap,
  HelpCircle,
  History,
  Inbox,
  MessageSquareText,
  PencilLine,
  Send,
  Settings,
} from "lucide-react";
import {
  addProfessorAvailability,
  addProfessorAdminTask,
  addProfessorFaq,
  createRoadmapRevisionRequest,
  deleteProfessorAdminTask,
  updateCounselingDetails,
  updateCounselingStatus,
  updateOwnCourseRoadmap,
  toggleProfessorAvailability,
} from "@/services/professor.actions";
import {
  ProfessorAvailability,
  ProfessorCourse,
  ProfessorCounselingRequest,
  ProfessorFaq,
  ProfessorTeachingSlot,
  ProfessorAdminTaskRecord,
} from "@/services/professor.service";
import type { RoadmapRevisionRequest } from "@/services/roadmap-revisions.service";
import { AcademicScheduleCard } from "@/components/dashboard/academic-schedule-card";
import type { AcademicEvent } from "@/types/academic-calendar";
import type {
  ProfessorCourseProgressReport,
  ProfessorCourseProgressReportResult,
} from "@/types/professor-course-progress-report";
import type {
  ProfessorAnonymousWeeklyAggregateReport,
  ProfessorAnonymousWeeklyAggregateResult,
} from "@/types/professor-anonymous-weekly-aggregate";
import { ProfessorCalendar } from "./professor-calendar";
import { ProfessorCourseProgressReportView } from "./professor-course-progress-report";
import { ProfessorQuestionInboxView } from "./professor-question-inbox";
import type { ProfessorQuestionInbox } from "@/types/professor-questions";
import {
  ProfessorHomeSectionTabs,
  type ProfessorHomeSection,
} from "./professor-home-section-tabs";
import { ProfessorPortalShortcutCard } from "./professor-portal-shortcut-card";
import { getCourseRoadmap, addCourseNotice, addCourseTextbook, removeCourseAssignment } from "@/services/course-settings.actions";
import {
  professorCourseManagementItems,
  professorWeeklyPlanPreviewLink,
} from "@/lib/professor-navigation";
import { saveProfessorRoadmapPersonalization } from "@/services/personalized-weekly-roadmap.actions";

// ============== TYPES ==============
type ProfessorWorkspaceProps = {
  initialTab?: ProfessorTab;
  professorCourseProgressReport: ProfessorCourseProgressReport;
  professorCourseProgressReportError: Extract<ProfessorCourseProgressReportResult, { ok: false }>["error"] | null;
  professorAnonymousWeeklyAggregate: ProfessorAnonymousWeeklyAggregateReport;
  professorAnonymousWeeklyAggregateError: Extract<ProfessorAnonymousWeeklyAggregateResult, { ok: false }>["error"] | null;
  professorQuestionInbox: ProfessorQuestionInbox;
  professor: {
    id: string;
    name: string;
    office: string | null;
    email: string | null;
    bio: string | null;
  };
  academicEvents: AcademicEvent[];
  courses: ProfessorCourse[];
  teachingSlots: ProfessorTeachingSlot[];
  availability: ProfessorAvailability[];
  faqs: ProfessorFaq[];
  counselingRequests: ProfessorCounselingRequest[];
  roadmapRequests: RoadmapRevisionRequest[];
  adminTasks: ProfessorAdminTaskRecord[];
  notificationCounts: {
    counseling: number;
    question: number;
  };
  initialSub?: string;
};

type ProfessorTab = "schedule" | "roadmap" | "questions" | "counseling" | "report";
type SubMenu = string;

type ProfessorAdminTask = {
  id: string;
  title: string;
  description: string;
  countLabel: string;
  priority: "urgent" | "normal" | "setup";
  tab: ProfessorTab;
};

type ProfessorAdminStat = {
  label: string;
  value: string;
  tone: "urgent" | "normal" | "calm";
};

// ============== CONSTANTS ==============
const weekDays = ["\uc77c", "\uc6d4", "\ud654", "\uc218", "\ubaa9", "\uae08", "\ud1a0"];

const professorTabs: Array<{ id: ProfessorTab; label: string }> = [
  { id: "schedule", label: "\uc77c\uc815 \uad00\ub9ac" },
  { id: "roadmap", label: "\uacfc\ubaa9 \uad00\ub9ac" },
  { id: "questions", label: "\uc9c8\ubb38 \uad00\ub9ac" },
  { id: "counseling", label: "\uc0c1\ub2f4 \uad00\ub9ac" },
  { id: "report", label: "\ud559\uc2b5 \ub9ac\ud3ec\ud2b8" },
];

const courseManagementIcons: Record<(typeof professorCourseManagementItems)[number]["id"], any> = {
  "roadmap-edit": PencilLine,
  "weekly-plan-preview": FileText,
  "sensitive-request": FileText,
  "course-faq": HelpCircle,
  "course-settings": Settings,
};

const sidebarMenus: Record<ProfessorTab, Array<{ id: SubMenu; label: string; icon: any }>> = {
  schedule: [
    { id: "calendar", label: "\uc2a4\ub9c8\ud2b8 \uc8fc\uac04 \uce98\ub9b0\ub354", icon: CalendarClock },
    { id: "manual-schedule", label: "\uc77c\uc815 \uc218\ub3d9 \ucd94\uac00/\uad00\ub9ac", icon: Clock },
  ],
  roadmap: [
    ...professorCourseManagementItems.map((item) => ({ id: item.id, label: item.label, icon: courseManagementIcons[item.id] })),
  ],
  questions: [
    { id: "incoming-questions", label: "\ub4e4\uc5b4\uc628 \uc9c8\ubb38 \ubcf4\uae30", icon: Inbox },
    { id: "manual-faq", label: "\uc218\ub3d9 \uc9c8\ubb38/\ub2f5\ubcc0 \ub4f1\ub85d", icon: PencilLine },
  ],
  counseling: [
    { id: "pending-counseling", label: "\ub300\uae30 \uc911\uc778 \uc0c1\ub2f4 \uc694\uccad", icon: Inbox },
    { id: "counseling-log", label: "\uc0c1\ub2f4 \uc694\uccad \ub85c\uadf8", icon: History },
  ],
  report: [
    { id: "course-progress-report", label: "\uacfc\ubaa9 \uc9c4\ud589 \ud604\ud669", icon: BarChart3 },
  ],
};

const counselingStatusLabels: Record<ProfessorCounselingRequest["status"] | "ANSWERED" | "PENDING", string> = {
  pending: "\uc2b9\uc778 \ub300\uae30",
  approved: "\uc2b9\uc778 \uc644\ub8cc",
  rejected: "\uc2dc\uac04 \uc870\uc815",
  cancelled: "\ucde8\uc18c\ub428",
  answered: "\ub2f5\ubcc0 \uc644\ub8cc",
  ANSWERED: "\ub2f5\ubcc0 \uc644\ub8cc",
  PENDING: "\uc2b9\uc778 \ub300\uae30",
};

function courseValue(course?: ProfessorCourse) {
  return course ? `${course.code}|${course.id}` : "";
}

// ============== MAIN COMPONENT ==============
export function ProfessorWorkspace({
  initialTab,
  initialSub,
  notificationCounts,
  academicEvents,
  professor,
  courses,
  teachingSlots,
  availability,
  faqs,
  counselingRequests,
  roadmapRequests,
  adminTasks,
  professorCourseProgressReport,
  professorCourseProgressReportError,
  professorAnonymousWeeklyAggregate,
  professorAnonymousWeeklyAggregateError,
  professorQuestionInbox,
}: ProfessorWorkspaceProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<ProfessorTab>(initialTab ?? "schedule");
  const [activeSub, setActiveSub] = useState<SubMenu>(() => {
    const defaultItems = sidebarMenus[initialTab ?? "schedule"];
    return initialSub && defaultItems.some((item) => item.id === initialSub)
      ? initialSub
      : defaultItems[0].id;
  });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const [toast, setToast] = useState("");
  const [currentCounselingRequests, setCurrentCounselingRequests] = useState<ProfessorCounselingRequest[]>(counselingRequests);
  const [currentNotificationCounts, setCurrentNotificationCounts] = useState(notificationCounts);
  const [announcements] = useState<Array<{ question: string; answer: string; courseName: string }>>([]);

  // When tab changes: auto-select first sub-menu, close sidebar
  function changeTab(tab: ProfessorTab, sub?: string) {
    setActiveTab(tab);
    setActiveSub(sub ?? sidebarMenus[tab][0].id);
    setSidebarOpen(false);
  }

  useEffect(() => {
    setActiveTab(initialTab ?? "schedule");
    const initialItems = sidebarMenus[initialTab ?? "schedule"];
    setActiveSub(
      initialSub && initialItems.some((item) => item.id === initialSub)
        ? initialSub
        : initialItems[0].id,
    );
  }, [initialSub, initialTab]);

  useEffect(() => {
    setCurrentCounselingRequests(counselingRequests);
  }, [counselingRequests]);

  useEffect(() => {
    setCurrentNotificationCounts(notificationCounts);
  }, [notificationCounts]);

  useEffect(() => {
    const toggleProfessorMenu = () => {
      setSidebarOpen(previous => !previous);
    };

    window.addEventListener("professor-mobile-menu-toggle", toggleProfessorMenu);

    return () => {
      window.removeEventListener("professor-mobile-menu-toggle", toggleProfessorMenu);
    };
  }, []);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent<boolean>("professor-mobile-menu-state", { detail: sidebarOpen }));
  }, [sidebarOpen]);

  // Toast: shows message at top, auto-dismiss after 3s
  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  }

  // Shared action runner
  function runAction(
    action: (formData: FormData) => Promise<{ message: string }>,
    formData: FormData,
    afterSuccess?: () => void,
  ) {
    setMessage("");
    startTransition(async () => {
      const result = await action(formData);
      setMessage(result.message);
      showToast(result.message);
      afterSuccess?.();
    });
  }

  function handleToggleBlackout(slot: { type?: string; day: number; specificDate?: string; start: string; end: string; isBlackout: boolean; id?: string; rawSlot?: any }) {
    if (slot.id) {
      if (slot.type === "admin_blackout" || slot.rawSlot?.type === "admin_blackout") {
        const formData = new FormData();
        formData.set("id", slot.id);
        runAction(deleteProfessorAdminTask, formData);
      } else {
        const formData = new FormData();
        formData.set("id", slot.id);
        formData.set("isActive", slot.isBlackout ? "true" : "false");
        runAction(toggleProfessorAvailability, formData);
      }
    } else {
      if (slot.specificDate) {
        const formData = new FormData();
        formData.set("professorId", professor.id);
        formData.set("title", `__BLACKOUT__${slot.specificDate}`);
        formData.set("dayOfWeek", String(slot.day));
        formData.set("startTime", slot.start);
        formData.set("endTime", slot.end);
        runAction(addProfessorAdminTask, formData);
      } else {
        const formData = new FormData();
        formData.set("professorId", professor.id);
        formData.set("dayOfWeek", String(slot.day));
        formData.set("startTime", slot.start);
        formData.set("endTime", slot.end);
        formData.set("slotMinutes", "30");
        formData.set("isActive", "false");
        runAction(addProfessorAvailability, formData);
      }
    }
  }

  function handleAddAdminTask(task: { title: string; dayOfWeek: number; startTime: string; endTime: string }) {
    const formData = new FormData();
    formData.set("professorId", professor.id);
    formData.set("title", task.title);
    formData.set("dayOfWeek", String(task.dayOfWeek));
    formData.set("startTime", task.startTime);
    formData.set("endTime", task.endTime);
    runAction(addProfessorAdminTask, formData);
  }

  function handleUpdateCounseling(requestId: string, note: string, location: string) {
    const formData = new FormData();
    formData.set("requestId", requestId);
    formData.set("professorNote", note);
    formData.set("location", location);
    runAction(updateCounselingDetails, formData);
  }

  function handleCancelCounseling(requestId: string) {
    const formData = new FormData();
    formData.set("requestId", requestId);
    formData.set("status", "cancelled");
    runAction((fd) => import("@/services/professor.actions").then(m => m.updateCounselingStatus(fd)), formData);
  }

  // Dashboard stats
  const adminStats = useMemo<ProfessorAdminStat[]>(() => {
    const pendingCounselingCount = currentCounselingRequests.filter((r) => r.status === "pending").length;
    const pendingRoadmapCount = roadmapRequests.filter((r) => r.status === "pending" || r.status === "assistant_reviewed").length;
    return [
      { label: "\uc0c1\ub2f4 \ub300\uae30", value: `${pendingCounselingCount}\uac74`, tone: pendingCounselingCount ? "urgent" : "calm" },
      { label: "\ub85c\ub4dc\ub9f5 \uac80\ud1a0", value: `${pendingRoadmapCount}\uac74`, tone: pendingRoadmapCount ? "normal" : "calm" },
      { label: "\uc0c1\ub2f4 \uc2ac\ub86f", value: `${availability.length}\uac1c`, tone: availability.length ? "calm" : "normal" },
      { label: "\ub2f4\ub2f9 \uacfc\ubaa9", value: `${courses.length}\uac1c`, tone: "calm" },
    ];
  }, [availability.length, currentCounselingRequests, courses.length, roadmapRequests]);

  // Dashboard tasks
  const dashboardTasks = useMemo<ProfessorAdminTask[]>(() => {
    const pendingRoadmapCount = roadmapRequests.filter((r) => r.status === "pending" || r.status === "assistant_reviewed").length;
    const tasks: ProfessorAdminTask[] = [];
    if (pendingRoadmapCount > 0) {
      tasks.push({ id: "pending-roadmap", title: "\ub85c\ub4dc\ub9f5 \uc218\uc815 \uc694\uccad \uac80\ud1a0", description: "\ud559\uc0dd\uc5d0\uac8c \ubcf4\uc77c \ucd94\ucc9c \ub85c\ub4dc\ub9f5\uacfc \ud559\uc2b5 \uc548\ub0b4 \uc218\uc815 \uc694\uccad\uc744 \ud655\uc778\ud569\ub2c8\ub2e4.", countLabel: `${pendingRoadmapCount}\uac74 \ud655\uc778`, priority: "normal", tab: "roadmap" });
    }
    if (faqs.length === 0) {
      tasks.push({ id: "faq-setup", title: "\ube48\ucd9c \uc9c8\ubb38 \ub2f5\ubcc0 \ub4f1\ub85d", description: "\ubc18\ubcf5 \uc9c8\ubb38\uc740 FAQ\ub85c \ub4f1\ub85d\ud574 \ud559\uc0dd\uc5d0\uac8c \ube60\ub974\uac8c \uc548\ub0b4\ud569\ub2c8\ub2e4.", countLabel: "\ubbf8\ub4f1\ub85d", priority: "setup", tab: "questions" });
    }
    return tasks;
}, [faqs.length, roadmapRequests]);

  const pendingCounselingRequestCount = currentCounselingRequests.filter((r) => r.status === "pending").length;
  const pendingQuestionCount = Object.values(professorQuestionInbox.categoryCounts).reduce(
    (total, count) => total + count,
    0,
  );
  const sidebarBadgeCounts = {
    pendingCounseling: Math.max(currentNotificationCounts.counseling, pendingCounselingRequestCount),
    incomingQuestions: Math.max(currentNotificationCounts.question, pendingQuestionCount),
  };

  // Current sidebar items for active tab
  const currentSidebarItems = sidebarMenus[activeTab];

  // Render sub-component based on activeSub
  function renderSubContent() {
    switch (activeSub) {
      case "calendar":
        return (
          <ScheduleCalendarSub
            adminStats={adminStats}
            adminTasks={adminTasks}
            academicEvents={academicEvents}
            dashboardTasks={dashboardTasks}
            availability={availability}
            counselingRequests={currentCounselingRequests}
            teachingSlots={teachingSlots}
            notificationCounts={currentNotificationCounts}
            pendingQuestionCount={pendingQuestionCount}
            onToggleBlackout={handleToggleBlackout}
            onAddAdminTask={handleAddAdminTask}
            onOpenTask={changeTab}
            onUpdateCounseling={handleUpdateCounseling}
            onCancelCounseling={handleCancelCounseling}
          />
        );
      case "manual-schedule":
        return (
          <ScheduleManualSub
            professor={professor}
            availability={availability}
            isPending={isPending}
            runAction={runAction}
            showToast={showToast}
          />
        );
      case "roadmap-edit":
        return (
          <RoadmapEditSub
            professor={professor}
            courses={courses}
            isPending={isPending}
            runAction={runAction}
            showToast={showToast}
          />
        );
      case "weekly-plan-preview":
        return (
          <section className="rounded-2xl bg-white p-6 shadow-sm">
            <h2 className="text-xl font-bold text-slate-900">주간 계획 초안 검토</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              교수 승인 전 주차별 계획을 검토하고 확정할 수 있습니다.
            </p>
            <Link
              className="mt-5 inline-flex rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700"
              href="/professor/weekly-plan-preview"
            >
              주간 계획 초안 열기
            </Link>
          </section>
        );
      case "sensitive-request":
        return (
          <SensitiveRequestSub
            courses={courses}
            roadmapRequests={roadmapRequests}
            isPending={isPending}
            showToast={showToast}
          />
        );
      case "course-settings":
        return (
          <CourseSettingsSub
            courses={courses}
            showToast={showToast}
          />
        );
      case "course-faq":
        return (
          <CourseFaqSub
            faqs={faqs}
            announcements={announcements}
          />
        );
      case "incoming-questions":
        return (
          <ProfessorQuestionInboxView
            inbox={professorQuestionInbox}
            courses={courses.map((course) => ({ id: course.id, code: course.code, name: course.name }))}
          />
        );
      case "manual-faq":
        return (
          <ManualFaqSub
            professor={professor}
            courses={courses}
            faqs={faqs}
            isPending={isPending}
            runAction={runAction}
            showToast={showToast}
          />
        );
      case "pending-counseling":
        return (
          <PendingCounselingSub
            counselingRequests={currentCounselingRequests}
            isPending={isPending}
            runAction={runAction}
            showToast={showToast}
            onRequestStatusChange={(updated) => {
              setCurrentCounselingRequests((prev) => prev.map((request) => (request.id === updated.id ? updated : request)));
              setCurrentNotificationCounts((prev) => ({ ...prev, counseling: Math.max(prev.counseling - 1, 0) }));
            }}
          />
        );
      case "counseling-log":
        return (
          <CounselingLogSub
            counselingRequests={counselingRequests}
          />
        );
      case "course-progress-report":
        return (
          <ProfessorCourseProgressReportView
            report={professorCourseProgressReport}
            error={professorCourseProgressReportError}
            anonymousAggregateReport={professorAnonymousWeeklyAggregate}
            anonymousAggregateError={professorAnonymousWeeklyAggregateError}
          />
        );
      default:
        return null;
    }
  }

  return (
    <div className="flex min-w-0 flex-col lg:flex-row min-h-screen bg-slate-50/50 font-sans" data-testid="professor-workspace">
      {/* Sidebar for PC / Mobile menu panel */}
      <aside className="hidden lg:flex lg:w-64 flex-shrink-0 bg-white border-b lg:border-b-0 lg:border-r border-slate-200/80 flex-col z-20 sticky top-0 lg:h-screen shadow-sm">
        <div className="p-5 lg:p-6">
          <div className="flex items-center gap-3">
            <div className="bg-emerald-100/80 text-emerald-700 p-2.5 rounded-xl shadow-sm">
              <GraduationCap size={22} strokeWidth={2.5} />
            </div>
            <div>
              <h2 className="font-bold text-slate-800 text-lg tracking-tight">{professor.name} 교수</h2>
              <p className="text-xs text-slate-500 font-medium">
                {professor.office ?? "연구실 미정"}
              </p>
            </div>
          </div>
        </div>
        
        {/* Navigation Menus */}
        <nav className="flex-1 lg:overflow-y-auto px-4 pb-4 lg:pb-6 flex lg:flex-col gap-3 lg:gap-2 overflow-x-auto scrollbar-hide border-b lg:border-none border-slate-100">
          {professorTabs.map((tab) => (
            <div key={tab.id} className="lg:mb-4 flex-shrink-0 flex lg:block items-center gap-2">
              <div className="hidden lg:block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 ml-2">
                {tab.label}
              </div>
              <div className="flex lg:flex-col gap-1.5">
                {sidebarMenus[tab.id].map((item) => {
                  const Icon = item.icon;
                  const isActive = activeTab === tab.id && activeSub === item.id;
                  const badgeCount =
                    item.id === "pending-counseling"
                      ? sidebarBadgeCounts.pendingCounseling
                      : item.id === "incoming-questions"
                      ? sidebarBadgeCounts.incomingQuestions
                      : 0;

                  return (
                    <Link
                      key={item.id}
                      href={`/professor?tab=${tab.id}&sub=${item.id}`}
                      onClick={() => changeTab(tab.id, item.id)}
                      className={`group relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all whitespace-nowrap ${
                        isActive
                          ? "bg-emerald-50 text-emerald-700 shadow-sm ring-1 ring-emerald-600/10"
                          : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                      }`}
                    >
                      <Icon size={18} className={isActive ? "text-emerald-600" : "text-slate-400"} />
                      <span>{item.label}</span>
                      {badgeCount > 0 ? (
                        <span className="badge-dot" aria-label={`${badgeCount}개의 알림`}>
                          {badgeCount}
                        </span>
                      ) : null}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      </aside>

      {/* Main Content Area */}
      <main className="min-w-0 flex-1 overflow-y-auto w-full p-4 lg:p-8 max-w-7xl mx-auto">
        {/* Content Header */}
        <header className="mb-5 lg:mb-8">
          <div>
            <h1 className="text-2xl lg:text-3xl font-bold text-slate-800 tracking-tight">
              {currentSidebarItems.find((item) => item.id === activeSub)?.label}
            </h1>
          </div>
        </header>

        {sidebarOpen ? (
          <aside
            aria-label="교수 메뉴"
            className="fixed inset-0 z-40 flex h-[100dvh] max-h-[100dvh] flex-col overflow-y-auto overscroll-contain bg-white px-5 pb-24 pt-24 lg:hidden"
            data-testid="professor-mobile-drawer"
            style={{ paddingBottom: "calc(6rem + env(safe-area-inset-bottom))" }}
          >
            <div className="mx-auto w-full max-w-lg space-y-5 pb-8">
              <p className="border-b border-slate-200 pb-3 text-sm font-semibold text-slate-700">교수 메뉴</p>
              {professorTabs.map((tab) => (
                <div key={tab.id}>
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                    {tab.label}
                  </div>
                  <div className="space-y-1">
                    {sidebarMenus[tab.id].map((item) => {
                      const Icon = item.icon;
                      const isActive = activeTab === tab.id && activeSub === item.id;
                      const badgeCount =
                        item.id === "pending-counseling"
                          ? sidebarBadgeCounts.pendingCounseling
                          : item.id === "incoming-questions"
                            ? sidebarBadgeCounts.incomingQuestions
                            : 0;
                      return (
                        <Link
                          key={item.id}
                          href={`/professor?tab=${tab.id}&sub=${item.id}`}
                          onClick={() => changeTab(tab.id, item.id)}
                          className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-all ${
                            isActive
                              ? "bg-emerald-50 text-emerald-700"
                              : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                          }`}
                        >
                          <Icon size={16} className={isActive ? "text-emerald-600" : "text-slate-400"} />
                          <span className="min-w-0 flex-1">{item.label}</span>
                          {badgeCount > 0 ? (
                            <span className="flex-shrink-0 rounded-full bg-rose-500 px-2 py-0.5 text-[11px] font-bold text-white">
                              {badgeCount}
                            </span>
                          ) : null}
                        </Link>
                      );
                    })}
                  </div>
                  {tab.id === "roadmap" ? (
                    <Link
                      href={professorWeeklyPlanPreviewLink.href}
                      onClick={() => setSidebarOpen(false)}
                      className="mt-1 flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-slate-600 transition-all hover:bg-emerald-50 hover:text-emerald-700"
                    >
                      <FileText size={16} className="text-slate-400" />
                      <span>{professorWeeklyPlanPreviewLink.label}</span>
                    </Link>
                  ) : null}
                </div>
              ))}
            </div>
          </aside>
        ) : null}

        {/* SubContent */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 p-4 lg:p-6 min-h-[600px]">
          {renderSubContent()}
        </div>
      </main>

      {/* Toast */}
      {toast ? (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-800 text-white px-5 py-3.5 rounded-xl shadow-2xl flex items-center gap-3 transition-all duration-300 transform translate-y-0 opacity-100">
          <Check size={18} className="text-emerald-400" />
          <span className="text-sm font-medium tracking-wide">{toast}</span>
        </div>
      ) : null}
    </div>
  );
}

// ============== SUB-COMPONENTS ==============

// --- ScheduleCalendarSub ---
function ScheduleCalendarSub({
  adminStats,
  adminTasks,
  academicEvents,
  dashboardTasks,
  availability,
  counselingRequests,
  teachingSlots,
  notificationCounts,
  pendingQuestionCount,
  onToggleBlackout,
  onAddAdminTask,
  onOpenTask,
  onUpdateCounseling,
  onCancelCounseling,
}: {
  adminStats: ProfessorAdminStat[];
  adminTasks: ProfessorAdminTaskRecord[];
  academicEvents: AcademicEvent[];
  dashboardTasks: ProfessorAdminTask[];
  availability: ProfessorAvailability[];
  counselingRequests: ProfessorCounselingRequest[];
  teachingSlots: ProfessorTeachingSlot[];
  notificationCounts: {
    counseling: number;
    question: number;
  };
  pendingQuestionCount: number;
  onToggleBlackout: (slot: any) => void;
  onAddAdminTask: (task: any) => void;
  onOpenTask: (tab: ProfessorTab) => void;
  onUpdateCounseling: (requestId: string, note: string, location: string) => void;
  onCancelCounseling: (requestId: string) => void;
}) {
  const [activeHomeSection, setActiveHomeSection] = useState<ProfessorHomeSection>("all");
  const panelId = "professor-home-section-panel";
  const tabIdPrefix = "professor-home-section-tab";
  const showAdmin = activeHomeSection === "all";
  const showCalendar = activeHomeSection === "all" || activeHomeSection === "calendar";
  const showAcademic = activeHomeSection === "all" || activeHomeSection === "academic";
  const showPortal = activeHomeSection === "all" || activeHomeSection === "portal";

  return (
    <section className="professor-home-overview" aria-label="교수 홈">
      <ProfessorHomeSectionTabs
        activeSection={activeHomeSection}
        onChange={setActiveHomeSection}
        panelId={panelId}
        tabIdPrefix={tabIdPrefix}
      />
      <div
        aria-labelledby={`${tabIdPrefix}-${activeHomeSection}`}
        className="professor-home-section-panel"
        id={panelId}
        role="tabpanel"
        tabIndex={0}
      >
        {showAdmin ? (
          <section className="professor-panel professor-admin-panel">
        <div className="community-section-heading">
          <h2>오늘 처리할 행정업무</h2>
          <span>{dashboardTasks.length ? `${dashboardTasks.length}개` : "정리됨"}</span>
        </div>

        <div className="professor-notification-summary-grid">
          {Math.max(notificationCounts.counseling, counselingRequests.filter((r) => r.status === "pending").length) > 0 ? (
            <Link
              href="/professor?tab=counseling&sub=pending-counseling"
              className="professor-notification-box professor-notification-box-urgent"
            >
              <div>
                <p>상담 요청</p>
                <strong>{Math.max(notificationCounts.counseling, counselingRequests.filter((r) => r.status === "pending").length)}건</strong>
              </div>
              <span>바로가기</span>
            </Link>
          ) : null}

          {Math.max(notificationCounts.question, pendingQuestionCount) > 0 ? (
            <Link
              href="/professor?tab=questions&sub=incoming-questions"
              className="professor-notification-box professor-notification-box-calm"
            >
              <div>
                <p>질문 요청</p>
                <strong>{Math.max(notificationCounts.question, pendingQuestionCount)}건</strong>
              </div>
              <span>바로가기</span>
            </Link>
          ) : null}
        </div>

        {dashboardTasks.length ? (
          <>
            <div className="professor-admin-task-list">
              {dashboardTasks.map((task) => (
                <button
                  className="professor-admin-task"
                  data-priority={task.priority}
                  key={task.id}
                  onClick={() => onOpenTask(task.tab)}
                  type="button"
                >
                  <span className="professor-admin-task-icon">
                    {task.tab === "roadmap" ? <PencilLine aria-hidden="true" /> : null}
                    {task.tab === "questions" ? <MessageSquareText aria-hidden="true" /> : null}
                  </span>
                  <span className="professor-admin-task-copy">
                    <strong>{task.title}</strong>
                    <small>{task.description}</small>
                  </span>
                  <em>{task.countLabel}</em>
                </button>
              ))}
            </div>

          </>
        ) : (
          <div className="professor-admin-clear">
            <Check aria-hidden="true" />
            <p>지금 바로 처리할 행정업무가 없습니다.</p>
          </div>
        )}
          </section>
        ) : null}

        {showCalendar ? (
          <section className="professor-panel">
            <ProfessorCalendar
              teachingSlots={teachingSlots}
              counselingRequests={counselingRequests}
              adminTasks={adminTasks}
              availability={availability}
              onToggleBlackout={onToggleBlackout}
              onAddAdminTask={onAddAdminTask}
              onUpdateCounseling={onUpdateCounseling}
              onCancelCounseling={onCancelCounseling}
            />
          </section>
        ) : null}

      {showAcademic ? (
        <AcademicScheduleCard
          academicEvents={academicEvents}
          description="주요 학사 일정과 교내 행정 일정을 확인하세요."
          headingId="professor-academic-schedule-title"
          notice="학교 사정에 따라 일정이 변경될 수 있습니다."
          title="학사일정"
        />
      ) : null}

        {showPortal ? <ProfessorPortalShortcutCard /> : null}
      </div>
    </section>
  );
}

// --- ScheduleManualSub ---
function ScheduleManualSub({
  professor,
  availability,
  isPending,
  runAction,
  showToast,
}: {
  professor: { id: string };
  availability: ProfessorAvailability[];
  isPending: boolean;
  runAction: (action: (fd: FormData) => Promise<{ message: string }>, fd: FormData, cb?: () => void) => void;
  showToast: (msg: string) => void;
}) {
  const [dayOfWeek, setDayOfWeek] = useState("2");
  const [startTime, setStartTime] = useState("10:00");
  const [endTime, setEndTime] = useState("12:00");
  const [slotMinutes, setSlotMinutes] = useState("30");

  function handleAddAvailability() {
    const formData = new FormData();
    formData.set("professorId", professor.id);
    formData.set("dayOfWeek", dayOfWeek);
    formData.set("startTime", startTime);
    formData.set("endTime", endTime);
    formData.set("slotMinutes", slotMinutes);
    runAction(addProfessorAvailability, formData);
  }

  return (
    <section className="professor-panel">
      <div className="community-section-heading">
        <h2>상담 가능 시간 관리</h2>
        <CalendarClock size={18} aria-hidden="true" />
      </div>
      <div className="professor-form-grid">
        <label className="field">
          <span>요일</span>
          <select value={dayOfWeek} onChange={(e) => setDayOfWeek(e.target.value)}>
            {weekDays.map((day, index) => (
              <option key={day} value={index}>{day}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>시작</span>
          <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
        </label>
        <label className="field">
          <span>종료</span>
          <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
        </label>
        <label className="field">
          <span>단위</span>
          <select value={slotMinutes} onChange={(e) => setSlotMinutes(e.target.value)}>
            <option value="15">15분</option>
            <option value="30">30분</option>
            <option value="60">60분</option>
          </select>
        </label>
      </div>
      <button
        className="button button-default button-md"
        disabled={isPending}
        onClick={handleAddAvailability}
        type="button"
      >
        시간 추가
        <Clock size={16} aria-hidden="true" />
      </button>

      <div className="professor-slot-list">
        {availability.map((item) => (
          <span key={item.id}>
            {weekDays[item.day_of_week]} {item.start_time.slice(0, 5)}-
            {item.end_time.slice(0, 5)} · {item.slot_minutes}분
            {item.is_active ? "" : " (비활성)"}
          </span>
        ))}
        {availability.length === 0 ? (
          <div className="community-empty">
            <p>등록된 상담 가능 시간이 없습니다.</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}

// --- RoadmapEditSub ---
function RoadmapEditSub({
  professor,
  courses,
  isPending,
  runAction,
  showToast,
}: {
  professor: { id: string };
  courses: ProfessorCourse[];
  isPending: boolean;
  runAction: (action: (fd: FormData) => Promise<{ message: string }>, fd: FormData, cb?: () => void) => void;
  showToast: (msg: string) => void;
}) {
  const [directCourse, setDirectCourse] = useState(courseValue(courses[0]));
  const [directTitle, setDirectTitle] = useState("");
  const [directReason, setDirectReason] = useState("");
  const [directBasics, setDirectBasics] = useState("");
  const [directFocus, setDirectFocus] = useState("");
  const [directGeneralMethod, setDirectGeneralMethod] = useState("");
  const [directCourseMethod, setDirectCourseMethod] = useState("");

  // Load roadmap data when course changes
  useEffect(() => {
    if (!directCourse) return;
    const courseId = directCourse.split("|")[1];
    if (!courseId) return;

    getCourseRoadmap(courseId).then((res) => {
      if (res.success && res.parsedText) {
        setDirectTitle("로드맵 수정 (Pre-filled)");
        setDirectReason(res.parsedText.substring(0, 50) + "...");
        setDirectBasics("기존 선수 지식 불러옴");
        setDirectFocus("기존 집중 키워드 불러옴");
        setDirectGeneralMethod("기존 일반 학습법 불러옴");
        setDirectCourseMethod("기존 해당 수업 학습법 불러옴");
      } else {
        setDirectTitle("");
        setDirectReason("");
        setDirectBasics("");
        setDirectFocus("");
        setDirectGeneralMethod("");
        setDirectCourseMethod("");
      }
    });
  }, [directCourse]);

  function handleDirectRoadmapUpdate() {
    const formData = new FormData();
    formData.set("courseId", directCourse.split("|")[1] ?? "");
    formData.set("foundationKnowledge", directBasics);
    formData.set("focusKeywords", directFocus);
    formData.set("professorNotes", [directGeneralMethod, directCourseMethod].filter(Boolean).join("\n\n"));
    runAction(saveProfessorRoadmapPersonalization, formData, () => {
      setDirectBasics("");
      setDirectGeneralMethod("");
      setDirectCourseMethod("");
      setDirectFocus("");
    });
  }

  return (
    <section className="professor-panel">
      <div className="community-section-heading">
        <h2>내 과목 로드맵 수정</h2>
        <PencilLine size={18} aria-hidden="true" />
      </div>
      <div className="professor-faq-form">
        <div className="professor-form-grid">
          <label className="field">
            <span>과목</span>
            <select value={directCourse} onChange={(e) => setDirectCourse(e.target.value)}>
              {courses.map((course) => (
                <option key={course.id} value={courseValue(course)}>{course.name}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>수정 제목</span>
            <input value={directTitle} onChange={(e) => setDirectTitle(e.target.value)} />
          </label>
        </div>
        <label className="field">
          <span>추천 사유</span>
          <textarea
            rows={3}
            value={directReason}
            onChange={(e) => setDirectReason(e.target.value)}
            placeholder="학생 로드맵 카드에 보일 짧은 설명"
          />
        </label>
        <div className="professor-form-grid">
          <label className="field">
            <span>기초 지식</span>
            <textarea
              rows={4}
              value={directBasics}
              onChange={(e) => setDirectBasics(e.target.value)}
              placeholder="한 줄에 하나씩 입력"
            />
          </label>
          <label className="field">
            <span>집중 키워드</span>
            <textarea
              rows={4}
              value={directFocus}
              onChange={(e) => setDirectFocus(e.target.value)}
              placeholder="한 줄에 하나씩 입력"
            />
          </label>
        </div>
        <label className="field">
          <span>일반 학습 방법</span>
          <textarea
            rows={3}
            value={directGeneralMethod}
            onChange={(e) => setDirectGeneralMethod(e.target.value)}
            placeholder="한 줄에 하나씩 입력"
          />
        </label>
        <label className="field">
          <span>해당 수업 학습 방법</span>
          <textarea
            rows={3}
            value={directCourseMethod}
            onChange={(e) => setDirectCourseMethod(e.target.value)}
            placeholder="한 줄에 하나씩 입력"
          />
        </label>
      </div>
      <button
        className="button button-default button-md"
        disabled={isPending || !courses.length}
        onClick={handleDirectRoadmapUpdate}
        type="button"
      >
        학생 로드맵에 바로 반영
        <Check size={16} aria-hidden="true" />
      </button>
    </section>
  );
}

// --- SensitiveRequestSub ---
function SensitiveRequestSub({
  courses,
  roadmapRequests,
  isPending,
  showToast,
}: {
  courses: ProfessorCourse[];
  roadmapRequests: RoadmapRevisionRequest[];
  isPending: boolean;
  showToast: (msg: string) => void;
}) {
  const [revisionCourse, setRevisionCourse] = useState(courseValue(courses[0]));

  async function handleRemoveCourse() {
    const courseId = revisionCourse.split("|")[1];
    if (!courseId) return;
    const formData = new FormData();
    formData.set("courseId", courseId);
    const res = await removeCourseAssignment(formData);
    showToast(res.message);
  }

  return (
    <section className="professor-panel">
      <div className="community-section-heading">
        <h2>민감한 수정 요청 (승인 필요)</h2>
        <span>{roadmapRequests.length}건</span>
      </div>
      <div className="professor-faq-form">
        <label className="field">
          <span>담당 과목 삭제 요청</span>
          <select value={revisionCourse} onChange={(e) => setRevisionCourse(e.target.value)}>
            {courses.map((course) => (
              <option key={course.id} value={courseValue(course)}>{course.name}</option>
            ))}
          </select>
        </label>
      </div>
      <button
        className="button button-default button-md"
        disabled={isPending}
        onClick={handleRemoveCourse}
        type="button"
      >
        해당 과목 담당 해제 요청
        <Send size={16} aria-hidden="true" />
      </button>
      <div className="professor-faq-list">
        {roadmapRequests.map((request) => (
          <article key={request.id}>
            <strong>{request.title}</strong>
            <p>
              {request.status} · {request.scope === "department" ? "학과 전체" : request.course_code}
            </p>
          </article>
        ))}
        {roadmapRequests.length === 0 ? (
          <div className="community-empty">
            <p>등록된 수정 요청이 없습니다.</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}

// --- CourseSettingsSub ---
function CourseSettingsSub({
  courses,
  showToast,
}: {
  courses: ProfessorCourse[];
  showToast: (msg: string) => void;
}) {
  const [settingsCourseId, setSettingsCourseId] = useState(courses[0]?.id ?? "");
  const [textbookName, setTextbookName] = useState("");
  const [textbookLink, setTextbookLink] = useState("");
  const [noticeTitle, setNoticeTitle] = useState("");
  const [noticeContent, setNoticeContent] = useState("");

  async function handleAddTextbook() {
    const formData = new FormData();
    formData.set("courseId", settingsCourseId);
    formData.set("name", textbookName);
    formData.set("link", textbookLink);
    const res = await addCourseTextbook(formData);
    showToast(res.message);
    setTextbookName("");
    setTextbookLink("");
  }

  async function handleAddNotice() {
    const formData = new FormData();
    formData.set("courseId", settingsCourseId);
    formData.set("title", noticeTitle);
    formData.set("content", noticeContent);
    const res = await addCourseNotice(formData);
    showToast(res.message);
    setNoticeTitle("");
    setNoticeContent("");
  }

  return (
    <section className="professor-panel">
      <div className="community-section-heading">
        <h2>기타 수업 설정</h2>
        <Settings size={18} aria-hidden="true" />
      </div>

      <div className="professor-faq-form">
        <label className="field">
          <span>대상 과목 선택</span>
          <select value={settingsCourseId} onChange={(e) => setSettingsCourseId(e.target.value)}>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>

        {/* Textbook section */}
        <div className="professor-panel">
          <div className="community-section-heading">
            <h3>수업에 교과서 추가</h3>
            <BookOpenText size={16} aria-hidden="true" />
          </div>
          <label className="field">
            <span>교과서 이름</span>
            <input
              placeholder="교과서 이름"
              value={textbookName}
              onChange={(e) => setTextbookName(e.target.value)}
            />
          </label>
          <label className="field">
            <span>참고 링크 (선택)</span>
            <input
              placeholder="참고 링크 (선택)"
              value={textbookLink}
              onChange={(e) => setTextbookLink(e.target.value)}
            />
          </label>
          <button onClick={handleAddTextbook} className="button button-default button-sm">
            교과서 등록 및 알림 발송
          </button>
        </div>

        {/* Notice section */}
        <div className="professor-panel">
          <div className="community-section-heading">
            <h3>공지사항 등록</h3>
            <MessageSquareText size={16} aria-hidden="true" />
          </div>
          <label className="field">
            <span>공지 제목</span>
            <input
              placeholder="공지 제목"
              value={noticeTitle}
              onChange={(e) => setNoticeTitle(e.target.value)}
            />
          </label>
          <label className="field">
            <span>공지 내용</span>
            <textarea
              placeholder="공지 내용"
              rows={3}
              value={noticeContent}
              onChange={(e) => setNoticeContent(e.target.value)}
            />
          </label>
          <button onClick={handleAddNotice} className="button button-default button-sm">
            공지 등록 및 알림 발송
          </button>
        </div>
      </div>
    </section>
  );
}

// --- CourseFaqSub ---
function CourseFaqSub({
  faqs,
  announcements,
}: {
  faqs: ProfessorFaq[];
  announcements: Array<{ question: string; answer: string; courseName: string }>;
}) {
  const allItems = useMemo(() => {
    const fromFaqs = faqs.map((faq) => ({
      id: faq.id,
      question: faq.question,
      answer: faq.answer,
      courseName: faq.course?.name ?? "공통",
    }));
    const fromAnnouncements = announcements.map((a, i) => ({
      id: `announce-${i}`,
      question: a.question,
      answer: a.answer,
      courseName: a.courseName,
    }));
    return [...fromAnnouncements, ...fromFaqs];
  }, [faqs, announcements]);

  return (
    <section className="professor-panel">
      <div className="community-section-heading">
        <h2>과목 관련 질문 모음</h2>
        <HelpCircle size={18} aria-hidden="true" />
      </div>
      {allItems.length > 0 ? (
        <div className="flex flex-col gap-4 mt-4">
          {allItems.map((item) => (
            <article key={item.id} className="bg-white border border-gray-100 rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow">
              <strong className="text-emerald-950 font-bold text-lg block mb-2">{item.question}</strong>
              <p className="text-gray-800 text-sm leading-relaxed mb-3">{item.answer}</p>
              <small className="text-xs text-gray-500 bg-gray-50 px-2 py-1 rounded-md">{item.courseName}</small>
            </article>
          ))}
        </div>
      ) : (
        <div className="community-empty">
          <p>등록된 FAQ가 없습니다.</p>
        </div>
      )}
    </section>
  );
}

// --- ManualFaqSub ---
function ManualFaqSub({
  professor,
  courses,
  faqs,
  isPending,
  runAction,
  showToast,
}: {
  professor: { id: string };
  courses: ProfessorCourse[];
  faqs: ProfessorFaq[];
  isPending: boolean;
  runAction: (action: (fd: FormData) => Promise<{ message: string }>, fd: FormData, cb?: () => void) => void;
  showToast: (msg: string) => void;
}) {
  const [faqCourseId, setFaqCourseId] = useState(courses[0]?.id ?? "");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");

  function handleAddFaq() {
    const formData = new FormData();
    formData.set("professorId", professor.id);
    formData.set("courseId", faqCourseId);
    formData.set("question", question);
    formData.set("answer", answer);
    runAction(addProfessorFaq, formData, () => {
      setQuestion("");
      setAnswer("");
    });
  }

  return (
    <section className="professor-panel">
      <div className="community-section-heading">
        <h2>수동 질문/답변 등록</h2>
        <MessageSquareText size={18} aria-hidden="true" />
      </div>
      <div className="professor-faq-form">
        <label className="field">
          <span>과목</span>
          <select value={faqCourseId} onChange={(e) => setFaqCourseId(e.target.value)}>
            {courses.map((course) => (
              <option key={course.id} value={course.id}>{course.name}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>질문</span>
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="학생 질문을 입력"
          />
        </label>
        <label className="field">
          <span>답변</span>
          <textarea
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="공식 답변으로 저장할 내용을 입력"
            rows={4}
          />
        </label>
      </div>
      <button
        className="button button-default button-md"
        disabled={isPending}
        onClick={handleAddFaq}
        type="button"
      >
        FAQ 저장
        <Send size={16} aria-hidden="true" />
      </button>
      <div className="professor-faq-list">
        {faqs.map((faq) => (
          <article key={faq.id}>
            <strong>{faq.question}</strong>
            <p>{faq.answer}</p>
            {faq.course?.name ? <small>{faq.course.name}</small> : null}
          </article>
        ))}
        {faqs.length === 0 ? (
          <div className="community-empty">
            <p>등록된 FAQ가 없습니다.</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}

// --- PendingCounselingSub ---
function PendingCounselingSub({
  counselingRequests,
  isPending,
  runAction,
  showToast,
  onRequestStatusChange,
}: {
  counselingRequests: ProfessorCounselingRequest[];
  isPending: boolean;
  runAction: (action: (fd: FormData) => Promise<{ message: string }>, fd: FormData, cb?: () => void) => void;
  showToast: (msg: string) => void;
  onRequestStatusChange: (updatedRequest: ProfessorCounselingRequest) => void;
}) {
  const pendingRequests = counselingRequests.filter((r) => r.status === "pending");
  const [localPending, setLocalPending] = useState(pendingRequests);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [suggestedTime, setSuggestedTime] = useState("");

  // Sync when counselingRequests prop changes
  useEffect(() => {
    setLocalPending(counselingRequests.filter((r) => r.status === "pending"));
  }, [counselingRequests]);

  function handleApprove(request: ProfessorCounselingRequest) {
    const formData = new FormData();
    formData.set("requestId", request.id);
    formData.set("status", "approved");
    formData.set("professorNote", "가능한 시간입니다. 상담 때 뵙겠습니다.");
    runAction(updateCounselingStatus, formData, () => {
      setLocalPending((prev) => prev.filter((r) => r.id !== request.id));
      onRequestStatusChange({ ...request, status: "approved" });
    });
    showToast("일정에 추가 했습니다");
  }

  function handleReject(request: ProfessorCounselingRequest) {
    if (!rejectNote) {
      showToast("거절 사유를 입력해 주세요.");
      return;
    }
    const formData = new FormData();
    formData.set("requestId", request.id);
    formData.set("status", "rejected");
    formData.set("professorNote", rejectNote);

    if (suggestedTime) {
      const suggestedDate = new Date(suggestedTime.replace(" ", "T"));
      if (!Number.isNaN(suggestedDate.getTime())) {
        formData.set("suggestedStart", suggestedDate.toISOString());
        const endDate = new Date(suggestedDate);
        endDate.setMinutes(endDate.getMinutes() + 30);
        formData.set("suggestedEnd", endDate.toISOString());
      }
    }

    runAction(updateCounselingStatus, formData, () => {
      setLocalPending((prev) => prev.filter((r) => r.id !== request.id));
      setRejectingId(null);
      setRejectNote("");
      setSuggestedTime("");
      onRequestStatusChange({ ...request, status: "rejected" });
    });
  }

  return (
    <section className="professor-panel">
      <div className="community-section-heading">
        <h2>대기 중인 상담 요청</h2>
        <span>{localPending.length}건</span>
      </div>
      {localPending.length > 0 ? (
        <div className="flex flex-col gap-4 mt-4">
          {localPending.map((request) => (
            <article key={request.id} className="bg-white border border-gray-100 rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden">
              <div className="absolute top-0 left-0 w-1 h-full bg-amber-400"></div>
              <div className="flex justify-between items-start mb-3">
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2.5">
                    <strong className="text-emerald-950 font-bold text-lg">{request.student ? `${request.student.name} (${request.student.identifier})` : request.student_id}</strong>
                    <span className="px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 text-xs font-semibold">
                      {counselingStatusLabels[request.status]}
                    </span>
                  </div>
                  <p className="text-gray-500 text-sm">{new Date(request.requested_start).toLocaleString("ko-KR", { dateStyle: "long", timeStyle: "short" })}</p>
                </div>
                <div className="text-right text-emerald-900/70 text-sm font-medium bg-emerald-50 px-3 py-1.5 rounded-md">
                  {request.topic}
                </div>
              </div>

              {rejectingId === request.id ? (
                <div className="mt-4 p-4 bg-gray-50 rounded-lg border border-gray-100 flex flex-col gap-3">
                  <div className="flex flex-col gap-1.5">
                    <span className="text-sm font-semibold text-emerald-950">거절 사유</span>
                    <textarea
                      rows={2}
                      value={rejectNote}
                      onChange={(e) => setRejectNote(e.target.value)}
                      placeholder="거절 사유를 입력하세요"
                      className="w-full border border-gray-200 rounded-md p-2 text-sm text-emerald-950 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <span className="text-sm font-semibold text-emerald-950">추천 시간 제안 (선택)</span>
                    <input
                      placeholder="예: 2026-07-14 11:00"
                      value={suggestedTime}
                      onChange={(e) => setSuggestedTime(e.target.value)}
                      className="w-full border border-gray-200 rounded-md p-2 text-sm text-emerald-950 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                  <div className="flex justify-end gap-2 mt-2">
                    <button
                      className="px-4 py-2 text-sm font-medium rounded-md border border-gray-200 text-gray-700 bg-white hover:bg-gray-50"
                      type="button"
                      onClick={() => {
                        setRejectingId(null);
                        setRejectNote("");
                        setSuggestedTime("");
                      }}
                    >
                      취소
                    </button>
                    <button
                      className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-md text-white bg-emerald-800 hover:bg-emerald-900 shadow-sm disabled:opacity-50"
                      disabled={isPending}
                      onClick={() => handleReject(request)}
                      type="button"
                    >
                      <Send size={14} aria-hidden="true" />
                      거절 안내 보내기
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex justify-end gap-2 mt-4 pt-4 border-t border-gray-50">
                  <button
                    className="px-4 py-2 text-sm font-medium rounded-md border border-gray-200 text-gray-700 bg-white hover:bg-gray-50 shadow-sm"
                    disabled={isPending}
                    onClick={() => setRejectingId(request.id)}
                    type="button"
                  >
                    거절 안내 보내기
                  </button>
                  <button
                    className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-md text-white bg-emerald-600 hover:bg-emerald-700 shadow-sm disabled:opacity-50"
                    disabled={isPending}
                    onClick={() => handleApprove(request)}
                    type="button"
                  >
                    <Check size={14} aria-hidden="true" />
                    승인
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      ) : (
        <div className="mt-4 p-8 text-center bg-gray-50 border border-gray-100 rounded-xl text-gray-500">
          <p>대기 중인 상담 요청이 없습니다.</p>
        </div>
      )}
    </section>
  );
}

// --- CounselingLogSub ---
function CounselingLogSub({
  counselingRequests,
}: {
  counselingRequests: ProfessorCounselingRequest[];
}) {
  const logEntries = counselingRequests.filter((r) => r.status !== "pending");

  return (
    <section className="professor-panel">
      <div className="community-section-heading">
        <h2>상담 요청 로그</h2>
        <History size={18} aria-hidden="true" />
      </div>
      {logEntries.length > 0 ? (
        <div className="flex flex-col gap-4 mt-4">
          {logEntries.map((entry) => (
            <div key={entry.id} className="bg-white border border-gray-100 rounded-xl p-5 shadow-sm">
              <div className="flex justify-between items-start mb-2">
                <strong className="text-emerald-950 font-bold">{entry.topic}</strong>
                <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${entry.status === "approved" ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}`}>
                  {counselingStatusLabels[entry.status]}
                </span>
              </div>
              <p className="text-sm text-gray-600 mb-1">학생: <span className="font-medium text-emerald-900">{entry.student ? `${entry.student.name} (${entry.student.identifier})` : entry.student_id}</span></p>
              <p className="text-sm text-gray-500">{new Date(entry.requested_start).toLocaleString("ko-KR", { dateStyle: "long", timeStyle: "short" })}</p>
              {entry.professor_note ? (
                <div className="mt-3 p-3 bg-gray-50 rounded-lg text-sm text-gray-700">
                  <span className="font-semibold text-emerald-950 block mb-1">교수 메모</span>
                  {entry.professor_note}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <div className="community-empty">
          <p>상담 로그가 없습니다.</p>
        </div>
      )}
    </section>
  );
}
