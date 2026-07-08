"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import {
  BookOpenText,
  CalendarClock,
  Check,
  ChevronRight,
  Clock,
  FileText,
  GraduationCap,
  HelpCircle,
  History,
  Inbox,
  Menu,
  MessageSquareText,
  PencilLine,
  Send,
  Settings,
  X,
} from "lucide-react";
import {
  addProfessorAvailability,
  addProfessorAdminTask,
  addProfessorFaq,
  createRoadmapRevisionRequest,
  deleteProfessorAdminTask,
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
import { ProfessorCalendar } from "./professor-calendar";
import { getCourseRoadmap, addCourseNotice, addCourseTextbook, removeCourseAssignment } from "@/services/course-settings.actions";

// ============== TYPES ==============
type ProfessorWorkspaceProps = {
  initialTab?: ProfessorTab;
  professor: {
    id: string;
    name: string;
    office: string | null;
    email: string | null;
    bio: string | null;
  };
  courses: ProfessorCourse[];
  teachingSlots: ProfessorTeachingSlot[];
  availability: ProfessorAvailability[];
  faqs: ProfessorFaq[];
  counselingRequests: ProfessorCounselingRequest[];
  roadmapRequests: RoadmapRevisionRequest[];
  adminTasks: ProfessorAdminTaskRecord[];
};

type ProfessorTab = "schedule" | "roadmap" | "questions" | "counseling";
type SubMenu = string;

type DummyQuestion = {
  id: string;
  studentName: string;
  studentId: string;
  major: string;
  courseName: string;
  question: string;
  date: string;
  status: "PENDING" | "ANSWERED";
  answer?: string;
};

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
];

const sidebarMenus: Record<ProfessorTab, Array<{ id: SubMenu; label: string; icon: any }>> = {
  schedule: [
    { id: "calendar", label: "\uc2a4\ub9c8\ud2b8 \uc8fc\uac04 \uce98\ub9b0\ub354", icon: CalendarClock },
    { id: "manual-schedule", label: "\uc77c\uc815 \uc218\ub3d9 \ucd94\uac00/\uad00\ub9ac", icon: Clock },
  ],
  roadmap: [
    { id: "roadmap-edit", label: "\ub0b4 \uacfc\ubaa9 \ub85c\ub4dc\ub9f5 \uc218\uc815", icon: PencilLine },
    { id: "sensitive-request", label: "\ubbfc\uac10\ud55c \uc218\uc815 \uc694\uccad", icon: FileText },
    { id: "course-settings", label: "\uae30\ud0c0 \uc218\uc5c5 \uc124\uc815", icon: Settings },
    { id: "course-faq", label: "\uacfc\ubaa9 \uad00\ub828 \uc9c8\ubb38 \ubaa8\uc74c", icon: HelpCircle },
  ],
  questions: [
    { id: "incoming-questions", label: "\ub4e4\uc5b4\uc628 \uc9c8\ubb38 \ubcf4\uae30", icon: Inbox },
    { id: "manual-faq", label: "\uc218\ub3d9 \uc9c8\ubb38/\ub2f5\ubcc0 \ub4f1\ub85d", icon: PencilLine },
  ],
  counseling: [
    { id: "pending-counseling", label: "\ub300\uae30 \uc911\uc778 \uc0c1\ub2f4 \uc694\uccad", icon: Inbox },
    { id: "counseling-log", label: "\uc0c1\ub2f4 \uc694\uccad \ub85c\uadf8", icon: History },
  ],
};

const initialDummyQuestions: DummyQuestion[] = [
  { id: "dq1", studentName: "\uae40\ubbfc\uc900", studentId: "20240101", major: "\ubc95\ud559\uacfc", courseName: "\ubbfc\uc0ac\uc18c\uc1a1\ubc95(2)", question: "\uc0c1\uc18c\uc2ec\uc5d0\uc11c \uc0c8\ub85c\uc6b4 \uc99d\uac70\ub97c \uc81c\ucd9c\ud560 \uc218 \uc788\ub294 \uc694\uac74\uc774 \uad81\uae08\ud569\ub2c8\ub2e4.", date: "2026-07-04", status: "PENDING" },
  { id: "dq2", studentName: "\uc774\uc218\uc9c4", studentId: "20250212", major: "\ud589\uc815\ud559\uacfc", courseName: "\ud68c\uc0ac\ubc95", question: "\uc8fc\uc8fc\ub300\ud45c\uc18c\uc1a1\uacfc \uc8fc\uc8fc\uc9c1\uc811\uc18c\uc1a1\uc758 \ucc28\uc774\uc810\uc744 \uc124\uba85\ud574\uc8fc\uc138\uc694.", date: "2026-07-05", status: "PENDING" },
  { id: "dq3", studentName: "\ubc15\uc9c0\uc740", studentId: "20230555", major: "\uc815\uce58\uc678\uad50\ud559\uacfc", courseName: "\ud589\uc815\uc808\ucc28\uc640\ud589\uc815\uad6c\uc81c", question: "\ud589\uc815\uc2ec\ud310\uacfc \ubbfc\uc0ac\uc18c\uc1a1\uc758 \uad00\ud560 \uad6c\ubd84\uc740 \uc5b4\ub5bb\uac8c \ud558\ub098\uc694?", date: "2026-07-05", status: "PENDING" },
  { id: "dq4", studentName: "\ucd5c\uc608\ub9b0", studentId: "20260012", major: "\ubc95\ud559\uacfc", courseName: "\ubbfc\ubc95\uc0ac\ub840\uc5f0\uc2b5", question: "\ucc44\uad8c\uc790\ub300\uc704\uad8c \ud589\uc0ac\uc758 \ubc94\uc704\uc5d0 \ub300\ud574 \uc88b\uc740 \ud310\ub840\uac00 \uc788\uc744\uae4c\uc694?", date: "2026-07-06", status: "PENDING" },
];

const counselingStatusLabels: Record<ProfessorCounselingRequest["status"], string> = {
  pending: "\uc2b9\uc778 \ub300\uae30",
  approved: "\uc2b9\uc778 \uc644\ub8cc",
  rejected: "\uc2dc\uac04 \uc870\uc815",
  cancelled: "\ucde8\uc18c\ub428",
};

function courseValue(course?: ProfessorCourse) {
  return course ? `${course.code}|${course.id}` : "";
}

// ============== MAIN COMPONENT ==============
export function ProfessorWorkspace({
  initialTab,
  professor,
  courses,
  teachingSlots,
  availability,
  faqs,
  counselingRequests,
  roadmapRequests,
  adminTasks,
}: ProfessorWorkspaceProps) {
  const [activeTab, setActiveTab] = useState<ProfessorTab>(initialTab ?? "schedule");
  const [activeSub, setActiveSub] = useState<SubMenu>(sidebarMenus[initialTab ?? "schedule"][0].id);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const [toast, setToast] = useState("");
  const [dummyQuestions, setDummyQuestions] = useState<DummyQuestion[]>(initialDummyQuestions);
  const [announcements, setAnnouncements] = useState<Array<{ question: string; answer: string; courseName: string }>>([]);

  // When tab changes: auto-select first sub-menu, close sidebar
  function changeTab(tab: ProfessorTab) {
    setActiveTab(tab);
    setActiveSub(sidebarMenus[tab][0].id);
    setSidebarOpen(false);
  }

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

  function handleToggleBlackout(slot: { day: number; specificDate?: string; start: string; end: string; isBlackout: boolean; id?: string; rawSlot?: any }) {
    if (slot.id) {
      if (slot.rawSlot?.type === "admin_blackout") {
        const formData = new FormData();
        formData.set("taskId", slot.id);
        runAction(deleteProfessorAdminTask, formData);
      } else {
        const formData = new FormData();
        formData.set("availabilityId", slot.id);
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
    runAction((fd) => import("@/services/professor.actions").then(m => m.updateCounselingDetails(fd)), formData);
  }

  function handleCancelCounseling(requestId: string) {
    const formData = new FormData();
    formData.set("requestId", requestId);
    formData.set("status", "cancelled");
    runAction((fd) => import("@/services/professor.actions").then(m => m.updateCounselingStatus(fd)), formData);
  }

  // Dashboard stats
  const adminStats = useMemo<ProfessorAdminStat[]>(() => {
    const pendingCounselingCount = counselingRequests.filter((r) => r.status === "pending").length;
    const pendingRoadmapCount = roadmapRequests.filter((r) => r.status === "pending" || r.status === "assistant_reviewed").length;
    return [
      { label: "\uc0c1\ub2f4 \ub300\uae30", value: `${pendingCounselingCount}\uac74`, tone: pendingCounselingCount ? "urgent" : "calm" },
      { label: "\ub85c\ub4dc\ub9f5 \uac80\ud1a0", value: `${pendingRoadmapCount}\uac74`, tone: pendingRoadmapCount ? "normal" : "calm" },
      { label: "\uc0c1\ub2f4 \uc2ac\ub86f", value: `${availability.length}\uac1c`, tone: availability.length ? "calm" : "normal" },
      { label: "\ub2f4\ub2f9 \uacfc\ubaa9", value: `${courses.length}\uac1c`, tone: "calm" },
    ];
  }, [availability.length, counselingRequests, courses.length, roadmapRequests]);

  // Dashboard tasks
  const dashboardTasks = useMemo<ProfessorAdminTask[]>(() => {
    const pendingCounselingCount = counselingRequests.filter((r) => r.status === "pending").length;
    const pendingRoadmapCount = roadmapRequests.filter((r) => r.status === "pending" || r.status === "assistant_reviewed").length;
    const tasks: ProfessorAdminTask[] = [];
    if (pendingCounselingCount > 0) {
      tasks.push({ id: "pending-counseling", title: "\uc0c1\ub2f4 \uc2e0\uccad \uc2b9\uc778", description: "\ud559\uc0dd \uc0c1\ub2f4 \uc2e0\uccad\uc744 \ud655\uc778\ud558\uace0 \uc2b9\uc778, \uac70\uc808, \ucd94\ucc9c \uc2dc\uac04 \uc81c\uc548\uc744 \ucc98\ub9ac\ud569\ub2c8\ub2e4.", countLabel: `${pendingCounselingCount}\uac74 \ub300\uae30`, priority: "urgent", tab: "counseling" });
    }
    if (pendingRoadmapCount > 0) {
      tasks.push({ id: "pending-roadmap", title: "\ub85c\ub4dc\ub9f5 \uc218\uc815 \uc694\uccad \uac80\ud1a0", description: "\ud559\uc0dd\uc5d0\uac8c \ubcf4\uc77c \ucd94\ucc9c \ub85c\ub4dc\ub9f5\uacfc \ud559\uc2b5 \uc548\ub0b4 \uc218\uc815 \uc694\uccad\uc744 \ud655\uc778\ud569\ub2c8\ub2e4.", countLabel: `${pendingRoadmapCount}\uac74 \ud655\uc778`, priority: "normal", tab: "roadmap" });
    }
    if (faqs.length === 0) {
      tasks.push({ id: "faq-setup", title: "\ube48\ucd9c \uc9c8\ubb38 \ub2f5\ubcc0 \ub4f1\ub85d", description: "\ubc18\ubcf5 \uc9c8\ubb38\uc740 FAQ\ub85c \ub4f1\ub85d\ud574 \ud559\uc0dd\uc5d0\uac8c \ube60\ub974\uac8c \uc548\ub0b4\ud569\ub2c8\ub2e4.", countLabel: "\ubbf8\ub4f1\ub85d", priority: "setup", tab: "questions" });
    }
    return tasks;
  }, [counselingRequests, faqs.length, roadmapRequests]);

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
            dashboardTasks={dashboardTasks}
            availability={availability}
            counselingRequests={counselingRequests}
            teachingSlots={teachingSlots}
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
          <IncomingQuestionsSub
            dummyQuestions={dummyQuestions}
            setDummyQuestions={setDummyQuestions}
            showToast={showToast}
            announcements={announcements}
            setAnnouncements={setAnnouncements}
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
            counselingRequests={counselingRequests}
            isPending={isPending}
            runAction={runAction}
            showToast={showToast}
          />
        );
      case "counseling-log":
        return (
          <CounselingLogSub
            counselingRequests={counselingRequests}
          />
        );
      default:
        return null;
    }
  }

  return (
    <section className="section professor-workspace" data-testid="professor-workspace">
      {/* Toast */}
      {toast ? (
        <div className={`professor-toast professor-toast-show`}>{toast}</div>
      ) : null}

      {/* Profile card */}
      <div className="professor-profile-card">
        <span className="icon-box">
          <GraduationCap aria-hidden="true" />
        </span>
        <div>
          <h2>{professor.name} 교수</h2>
          <p>
            {professor.office ?? "연구실 미정"} · {professor.email ?? "이메일 미정"}
          </p>
        </div>
      </div>

      {/* Top Header Navigation (Dropdown) */}
      <nav className="flex items-center gap-8 mb-8 border-b border-gray-200" aria-label="교수 기능">
        {professorTabs.map((tab) => (
          <div key={tab.id} className="relative group pb-4">
            <button
              className={`text-lg font-bold transition-colors ${
                activeTab === tab.id ? "text-emerald-700" : "text-gray-600 group-hover:text-emerald-600"
              }`}
              onClick={() => changeTab(tab.id)}
            >
              {tab.label}
            </button>
            {activeTab === tab.id && (
              <div className="absolute bottom-0 left-0 w-full h-[3px] bg-emerald-600 rounded-t-md" />
            )}
            <div className="absolute left-0 top-full mt-0 w-56 bg-white/95 backdrop-blur-md border border-gray-100 rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.12)] opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-300 z-50 overflow-hidden transform origin-top translate-y-[-10px] group-hover:translate-y-0">
              <div className="py-2">
                {sidebarMenus[tab.id].map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      className={`flex items-center gap-3 w-full px-5 py-3 text-sm text-left hover:bg-emerald-50/80 transition-colors ${
                        activeSub === item.id ? "bg-emerald-50 text-emerald-700 font-semibold" : "text-gray-700"
                      }`}
                      onClick={() => {
                        setActiveTab(tab.id);
                        setActiveSub(item.id);
                      }}
                    >
                      <Icon size={16} strokeWidth={activeSub === item.id ? 2.5 : 2} />
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        ))}
      </nav>

      {/* Content area */}
      <div className="professor-content-area">
        <div className="professor-content-header">
          <h2>{currentSidebarItems.find((item) => item.id === activeSub)?.label}</h2>
        </div>
        {renderSubContent()}
      </div>

      {message ? <p className="mypage-message">{message}</p> : null}
    </section>
  );
}

// ============== SUB-COMPONENTS ==============

// --- ScheduleCalendarSub ---
function ScheduleCalendarSub({
  adminStats,
  adminTasks,
  dashboardTasks,
  availability,
  counselingRequests,
  teachingSlots,
  onToggleBlackout,
  onAddAdminTask,
  onOpenTask,
  onUpdateCounseling,
  onCancelCounseling,
}: {
  adminStats: ProfessorAdminStat[];
  adminTasks: ProfessorAdminTaskRecord[];
  dashboardTasks: ProfessorAdminTask[];
  availability: ProfessorAvailability[];
  counselingRequests: ProfessorCounselingRequest[];
  teachingSlots: ProfessorTeachingSlot[];
  onToggleBlackout: (slot: any) => void;
  onAddAdminTask: (task: any) => void;
  onOpenTask: (tab: ProfessorTab) => void;
  onUpdateCounseling: (requestId: string, note: string, location: string) => void;
  onCancelCounseling: (requestId: string) => void;
}) {
  return (
    <>
      {/* Admin stats + tasks */}
      <section className="professor-panel professor-admin-panel">
        <div className="community-section-heading">
          <h2>오늘 처리할 행정업무</h2>
          <span>{dashboardTasks.length ? `${dashboardTasks.length}개` : "정리됨"}</span>
        </div>
        <div className="professor-admin-stat-grid" aria-label="교수 업무 요약">
          {adminStats.map((stat) => (
            <div data-tone={stat.tone} key={stat.label}>
              <span>{stat.label}</span>
              <strong>{stat.value}</strong>
            </div>
          ))}
        </div>
        {dashboardTasks.length ? (
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
                  {task.tab === "counseling" ? <CalendarClock aria-hidden="true" /> : null}
                  {task.tab === "roadmap" ? <PencilLine aria-hidden="true" /> : null}
                  {task.tab === "questions" ? <MessageSquareText aria-hidden="true" /> : null}
                </span>
                <span>
                  <strong>{task.title}</strong>
                  <small>{task.description}</small>
                </span>
                <em>{task.countLabel}</em>
              </button>
            ))}
          </div>
        ) : (
          <div className="professor-admin-clear">
            <Check aria-hidden="true" />
            <p>지금 바로 처리할 행정업무가 없습니다.</p>
          </div>
        )}
      </section>

      {/* Calendar */}
      <section className="professor-panel">
        <div className="community-section-heading">
          <h2>스마트 주간 캘린더</h2>
        </div>
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
    </>
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
    formData.set("course", directCourse);
    formData.set("title", directTitle);
    formData.set("shortReason", directReason);
    formData.set("basics", directBasics);
    formData.set("generalStudyMethod", directGeneralMethod);
    formData.set("courseStudyMethod", directCourseMethod);
    formData.set("weeklyFocus", directFocus);
    runAction(updateOwnCourseRoadmap, formData, () => {
      setDirectReason("");
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
        <div className="professor-faq-list">
          {allItems.map((item) => (
            <article key={item.id} className="professor-faq-card">
              <strong>{item.question}</strong>
              <p>{item.answer}</p>
              <small>{item.courseName}</small>
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

// --- IncomingQuestionsSub ---
function IncomingQuestionsSub({
  dummyQuestions,
  setDummyQuestions,
  showToast,
  announcements,
  setAnnouncements,
}: {
  dummyQuestions: DummyQuestion[];
  setDummyQuestions: React.Dispatch<React.SetStateAction<DummyQuestion[]>>;
  showToast: (msg: string) => void;
  announcements: Array<{ question: string; answer: string; courseName: string }>;
  setAnnouncements: React.Dispatch<React.SetStateAction<Array<{ question: string; answer: string; courseName: string }>>>;
}) {
  const [answeringId, setAnsweringId] = useState<string | null>(null);
  const [answerText, setAnswerText] = useState("");
  const [registerAsNotice, setRegisterAsNotice] = useState(false);

  function handleSubmitAnswer(q: DummyQuestion) {
    if (!answerText.trim()) return;

    setDummyQuestions((prev) =>
      prev.map((item) =>
        item.id === q.id
          ? { ...item, status: "ANSWERED" as const, answer: answerText }
          : item,
      ),
    );

    if (registerAsNotice) {
      setAnnouncements((prev) => [
        ...prev,
        { question: q.question, answer: answerText, courseName: q.courseName },
      ]);
    }

    showToast("답변이 등록되었습니다.");
    setAnsweringId(null);
    setAnswerText("");
    setRegisterAsNotice(false);
  }

  return (
    <section className="professor-panel">
      <div className="community-section-heading">
        <h2>들어온 질문 보기</h2>
        <Inbox size={18} aria-hidden="true" />
      </div>
      {dummyQuestions.length > 0 ? (
        <div className="professor-request-list">
          {dummyQuestions.map((q) => (
            <article key={q.id} className="professor-question-card">
              <div>
                <strong>{q.studentName}</strong>
                <span className="professor-status-badge" data-status={q.status}>
                  {q.status === "PENDING" ? "대기" : "답변 완료"}
                </span>
              </div>
              <p>{q.courseName} · {q.date}</p>
              <p>{q.question}</p>

              {q.status === "ANSWERED" && q.answer ? (
                <div className="professor-faq-card">
                  <strong>답변:</strong>
                  <p>{q.answer}</p>
                </div>
              ) : null}

              {q.status === "PENDING" ? (
                <div className="professor-question-actions">
                  {answeringId === q.id ? (
                    <div className="professor-question-answer-form">
                      <label className="field">
                        <span>답변 입력</span>
                        <textarea
                          rows={3}
                          value={answerText}
                          onChange={(e) => setAnswerText(e.target.value)}
                          placeholder="답변을 입력하세요"
                        />
                      </label>
                      <label className="checkbox-row">
                        <input
                          type="checkbox"
                          checked={registerAsNotice}
                          onChange={(e) => setRegisterAsNotice(e.target.checked)}
                        />
                        <span>공지사항으로 등록하기</span>
                      </label>
                      <div className="professor-request-actions">
                        <button
                          className="button button-default button-sm"
                          type="button"
                          onClick={() => handleSubmitAnswer(q)}
                        >
                          <Send size={14} aria-hidden="true" />
                          제출
                        </button>
                        <button
                          className="button button-outline button-sm"
                          type="button"
                          onClick={() => {
                            setAnsweringId(null);
                            setAnswerText("");
                            setRegisterAsNotice(false);
                          }}
                        >
                          취소
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      className="button button-default button-sm"
                      type="button"
                      onClick={() => setAnsweringId(q.id)}
                    >
                      답변하기
                    </button>
                  )}
                </div>
              ) : null}
            </article>
          ))}
        </div>
      ) : (
        <div className="community-empty">
          <p>들어온 질문이 없습니다.</p>
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
}: {
  counselingRequests: ProfessorCounselingRequest[];
  isPending: boolean;
  runAction: (action: (fd: FormData) => Promise<{ message: string }>, fd: FormData, cb?: () => void) => void;
  showToast: (msg: string) => void;
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
        <div className="professor-log-timeline">
          {logEntries.map((entry) => (
            <div key={entry.id} className="professor-log-entry">
              <div>
                <strong>{entry.topic}</strong>
                <span className="professor-status-badge" data-status={entry.status}>
                  {counselingStatusLabels[entry.status]}
                </span>
              </div>
              <p>학생: {entry.student ? `${entry.student.name} (${entry.student.identifier})` : entry.student_id}</p>
              <p>{new Date(entry.requested_start).toLocaleString("ko-KR")}</p>
              {entry.professor_note ? (
                <p>{entry.professor_note}</p>
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
