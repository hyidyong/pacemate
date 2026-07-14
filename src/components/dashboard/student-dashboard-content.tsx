"use client";

import { useState } from "react";
import PortalShortcutCard from "@/components/PortalShortcutCard";
import { AcademicScheduleCard } from "@/components/dashboard/academic-schedule-card";
import {
  DashboardSectionTabs,
  type DashboardSection,
} from "@/components/dashboard/dashboard-section-tabs";
import { StudentTodoCard, type StudentTodoItem } from "@/components/dashboard/student-todo-card";
import { TodayTimetableWidget } from "@/components/dashboard/today-timetable-widget";
import type { StudentCourseRecord } from "@/services/student-community.service";
import type { AcademicEvent } from "@/types/academic-calendar";

type StudentDashboardContentProps = {
  academicEvents: AcademicEvent[];
  myCourses: StudentCourseRecord[];
  todoItems: StudentTodoItem[];
};

export function StudentDashboardContent({
  academicEvents,
  myCourses,
  todoItems,
}: StudentDashboardContentProps) {
  const [activeSection, setActiveSection] = useState<DashboardSection>("all");
  const panelId = "student-dashboard-section-panel";
  const tabIdPrefix = "student-dashboard-section-tab";

  const showTimetable = activeSection === "all" || activeSection === "timetable";
  const showTodo = activeSection === "all" || activeSection === "todo";
  const showPortal = activeSection === "all" || activeSection === "portal";
  const showAcademic = activeSection === "all" || activeSection === "academic";

  return (
    <section className="dashboard-student-overview" aria-label="학생 대시보드">
      {/* TODO: 알람 요약 UI를 붙일 때는 기존 notifications service 결과만 표시하고, 새 Supabase/API 로직은 별도 범위에서 설계한다. */}
      <DashboardSectionTabs
        activeSection={activeSection}
        onChange={setActiveSection}
        panelId={panelId}
        tabIdPrefix={tabIdPrefix}
      />
      <div
        aria-labelledby={`${tabIdPrefix}-${activeSection}`}
        className="dashboard-student-panel"
        id={panelId}
        role="tabpanel"
        tabIndex={0}
      >
        {showTimetable && <TodayTimetableWidget myCourses={myCourses} />}
        {showTodo && <StudentTodoCard items={todoItems} />}
        {showPortal && <PortalShortcutCard description="" />}
        {showAcademic && <AcademicScheduleCard academicEvents={academicEvents} />}
      </div>
    </section>
  );
}
