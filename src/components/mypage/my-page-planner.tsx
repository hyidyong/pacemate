"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import {
  Bookmark,
  CalendarPlus,
  MessageSquareText,
  Search,
  Star,
  Trash2,
  ThumbsUp,
  MessageCircle,
  Circle,
  FileText,
  CheckCircle2
} from "lucide-react";
import {
  addCourseToSchedule,
  removeCustomCourseFromSchedule,
  removeCourseFromSchedule,
  saveCustomCourseToSchedule,
} from "@/services/student-community.actions";
import {
  createLocalTimetableCourse,
  isLocalTimetableCourse,
  removeTimetableCourse,
  type TimetableDisplayItem,
  upsertTimetableCourse,
  useStudentTimetable,
} from "@/lib/student-timetable";
import {
  findScheduleConflicts,
  toKoreanWeekday,
  type ExistingScheduleEntry,
} from "@/services/student-timetable.rules";
import { ScheduleConflictDialog } from "@/components/schedule/schedule-conflict-dialog";
import type { ScheduleConflictInfo } from "@/components/schedule/schedule-conflict-list";
import type {
  CommunityPostRecord,
  CourseRecord,
  StudentCourseRecord,
} from "@/services/student-community.service";
import {
  getLocalDateKey,
  getTodoTypeFromCategory,
  normalizeStoredTodo,
  normalizeStoredTodos,
  STUDENT_TODO_DONE_STORAGE_KEY,
  STUDENT_TODO_STORAGE_KEY,
  type StudentTodoCategory,
  type StudentTodoItem,
} from "@/components/dashboard/student-todo-card";
import { MyPageSectionTabs, type MyPageSection } from "@/components/mypage/my-page-section-tabs";

type MyPagePlannerProps = {
  courses: CourseRecord[];
  myCourses: StudentCourseRecord[];
  myPosts: CommunityPostRecord[];
  scrapedPosts: CommunityPostRecord[];
  commentedPosts: CommunityPostRecord[];
  likedPosts: CommunityPostRecord[];
};

const days = ["월", "화", "수", "목", "금", "토", "일"];
const TIMETABLE_TIME_COLUMN = "clamp(1.85rem, 8vw, 2.75rem)";

function toMinutes(time: string) {
  const [hour, minute] = time.split(":").map(Number);
  return Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : null;
}

// 5 Pastel colors for timetable blocks
const blockColors = [
  "bg-violet-50 text-violet-900",
  "bg-blue-50 text-blue-900",
  "bg-emerald-50 text-emerald-900",
  "bg-amber-50 text-amber-900",
  "bg-rose-50 text-rose-900",
];

function TimetableCourseCell({
  item,
  colorClass,
  onRemove,
}: {
  item: TimetableDisplayItem;
  colorClass: string;
  onRemove: (enrollmentId: string) => void;
}) {
  return (
    <div className={`group absolute flex h-full w-full min-w-0 flex-col items-start justify-start overflow-hidden rounded-sm p-1 shadow-sm transition-transform hover:z-10 hover:scale-[1.02] sm:p-1.5 ${colorClass}`}>
      <span className="line-clamp-2 w-full break-all text-[11px] font-bold leading-tight">{item.course.name}</span>
      <span className="mt-0.5 flex w-full min-w-0 flex-col gap-0.5 truncate text-[9px] font-medium leading-none opacity-70">
        <span className="w-full truncate">{item.classroom ?? "강의실 미정"}</span>
      </span>
      <div className="absolute inset-0 flex items-center justify-center rounded-sm bg-slate-950/35 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          onClick={() => onRemove(item.id)}
          className="rounded-full bg-white p-1.5 text-red-500 shadow-md transition-colors hover:bg-red-50"
          title="과목 삭제"
          type="button"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

export function MyPagePlanner({
  courses,
  myCourses,
  myPosts,
  scrapedPosts,
  commentedPosts,
  likedPosts,
}: MyPagePlannerProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [selectedCourseId, setSelectedCourseId] = useState(courses[0]?.id ?? "");
  const [day, setDay] = useState("월");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:15");
  const [classroom, setClassroom] = useState("");
  const [regularSlotsJson, setRegularSlotsJson] = useState("");
  const [customTitle, setCustomTitle] = useState("");
  const [customSlots, setCustomSlots] = useState([{ day: "월", startTime: "09:00", endTime: "10:15", classroom: "" }]);
  const [editingCustomId, setEditingCustomId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const [isPending, startTransition] = useTransition();
  const [activeCommunityTab, setActiveCommunityTab] = useState<"my" | "scrap" | "comment" | "like">("my");
  const [activeTab, setActiveTab] = useState<MyPageSection>("all");
  const [todoTitle, setTodoTitle] = useState("");
  const [todoDueDate, setTodoDueDate] = useState("");
  const [todoCategory, setTodoCategory] = useState<StudentTodoCategory>("과제");
  const [todoEditId, setTodoEditId] = useState<string | null>(null);
  const [todos, setTodos] = useState<StudentTodoItem[]>([]);
  const [doneIds, setDoneIds] = useState<string[]>([]);
  const [isTodoLoaded, setIsTodoLoaded] = useState(false);
  const [isDoneLoaded, setIsDoneLoaded] = useState(false);
  const { timetableCourses, timetableItems, setTimetableCourses } = useStudentTimetable(myCourses);
  const [syncedLocalCourseIds, setSyncedLocalCourseIds] = useState<string[]>([]);
  const [conflict, setConflict] = useState<ScheduleConflictInfo | null>(null);
  const [retryWithOverlapConfirmed, setRetryWithOverlapConfirmed] = useState<(() => void) | null>(null);

  const selectedCourse = courses.find((course) => course.id === selectedCourseId) ?? courses[0];

  // The other slots already on this timetable, used for both the live
  // in-form warning and to build the confirm-anyway retry payload.
  const existingScheduleEntries = useMemo<ExistingScheduleEntry[]>(
    () =>
      timetableItems.flatMap((item) => {
        const dayOfWeek = toKoreanWeekday(item.schedule_day);
        if (!dayOfWeek || !item.start_time || !item.end_time) return [];
        return [
          {
            parentId: item.parentId,
            label: item.course.name,
            dayOfWeek,
            startTime: item.start_time,
            endTime: item.end_time,
          },
        ];
      }),
    [timetableItems],
  );

  const registerFormConflicts = useMemo(() => {
    const dayOfWeek = toKoreanWeekday(day);
    if (!dayOfWeek || !startTime || !endTime || startTime >= endTime) return [];
    return findScheduleConflicts(
      [{ dayOfWeek, startTime, endTime, classroom: classroom || null }],
      existingScheduleEntries,
    );
  }, [day, startTime, endTime, classroom, existingScheduleEntries]);

  const customSlotConflicts = useMemo(
    () =>
      customSlots.map((slot) => {
        const dayOfWeek = toKoreanWeekday(slot.day);
        if (!dayOfWeek || !slot.startTime || !slot.endTime || slot.startTime >= slot.endTime) return [];
        return findScheduleConflicts(
          [{ dayOfWeek, startTime: slot.startTime, endTime: slot.endTime, classroom: slot.classroom || null }],
          existingScheduleEntries,
          editingCustomId ? `custom:${editingCustomId}` : undefined,
        );
      }),
    [customSlots, existingScheduleEntries, editingCustomId],
  );

  // Keep the server's first render deterministic, then set the browser-local
  // default date after hydration.
  useEffect(() => {
    setTodoDueDate((value) => value || getLocalDateKey(new Date()));
  }, []);

  const filteredCourses = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return courses.filter((course) =>
      [course.name, course.code, course.category ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery),
    );
  }, [courses, query]);

  const scheduledCourseIds = new Set(timetableCourses.map((item) => item.course.id));

  useEffect(() => {
    const unsyncedLocalCourses = timetableCourses.filter(
      (item) => isLocalTimetableCourse(item.id) && !syncedLocalCourseIds.includes(item.id),
    );
    if (!unsyncedLocalCourses.length) return;

    let cancelled = false;
    async function syncLocalCourses() {
      let nextCourses = timetableCourses;
      for (const item of unsyncedLocalCourses) {
        const formData = new FormData();
        formData.set("courseId", item.course.id);
        formData.set("scheduleDay", item.schedule_day ?? day);
        formData.set("startTime", item.start_time ?? "09:00");
        formData.set("endTime", item.end_time ?? "10:15");
        formData.set("classroom", item.classroom ?? "");
        formData.set("semesterLabel", item.semester_label ?? "2026-2");

        const result = await addCourseToSchedule(formData);
        if (cancelled) return;
        if (result.ok && result.course) {
          nextCourses = upsertTimetableCourse(removeTimetableCourse(nextCourses, item.id), result.course);
          setTimetableCourses(nextCourses);
        }
        setSyncedLocalCourseIds((ids) => [...new Set([...ids, item.id])]);
      }
      router.refresh();
    }

    void syncLocalCourses();

    return () => {
      cancelled = true;
    };
  }, [day, router, setTimetableCourses, syncedLocalCourseIds, timetableCourses]);

  function submitAddCourse(formData: FormData, optimisticCourseId: string | null) {
    startTransition(async () => {
      const result = await addCourseToSchedule(formData);

      if (result.ok && result.course) {
        setFeedback({ ok: true, message: result.message });
        setTimetableCourses((previous) =>
          upsertTimetableCourse(
            optimisticCourseId ? removeTimetableCourse(previous, optimisticCourseId) : previous,
            result.course as StudentCourseRecord,
          ),
        );
        setConflict(null);
        setRetryWithOverlapConfirmed(null);
        router.refresh();
        return;
      }

      // The server didn't accept it — drop the optimistic block instead of
      // leaving a phantom entry on the grid.
      if (optimisticCourseId) {
        setTimetableCourses((previous) => removeTimetableCourse(previous, optimisticCourseId));
      }

      if ("conflict" in result && result.conflict) {
        setConflict(result.conflict);
        const confirmedFormData = new FormData();
        formData.forEach((value, key) => confirmedFormData.set(key, value as string));
        confirmedFormData.set("confirmOverlap", "true");
        setRetryWithOverlapConfirmed(() => () => submitAddCourse(confirmedFormData, null));
        return;
      }

      setConflict(null);
      setFeedback({ ok: false, message: result.message });
    });
  }

  function handleAddCourse() {
    if (!selectedCourse) return;

    if (scheduledCourseIds.has(selectedCourse.id)) {
      setFeedback({ ok: true, message: "이미 시간표에 추가된 과목입니다." });
      return;
    }

    const nextCourse = createLocalTimetableCourse({
      course: selectedCourse,
      scheduleDay: day,
      startTime,
      endTime,
      classroom: classroom || "강의실 미정",
    });

    setTimetableCourses((previous) => upsertTimetableCourse(previous, nextCourse));
    setFeedback({ ok: true, message: "시간표에 등록 중입니다." });

    const formData = new FormData();
    formData.set("courseId", selectedCourse.id);
    formData.set("scheduleDay", day);
    formData.set("startTime", startTime);
    formData.set("endTime", endTime);
    formData.set("classroom", classroom || nextCourse.classroom || "");
    formData.set("semesterLabel", "2026-2");
    if (regularSlotsJson.trim()) formData.set("scheduleSlots", regularSlotsJson);

    submitAddCourse(formData, nextCourse.id);
  }

  function submitCustomCourse(formData: FormData) {
    startTransition(async () => {
      const result = await saveCustomCourseToSchedule(formData);

      if (result.ok && result.course) {
        setFeedback({ ok: true, message: result.message });
        setTimetableCourses((previous) => upsertTimetableCourse(previous, result.course as StudentCourseRecord));
        setCustomTitle("");
        setEditingCustomId(null);
        setCustomSlots([{ day: days[0], startTime: "09:00", endTime: "10:15", classroom: "" }]);
        setConflict(null);
        setRetryWithOverlapConfirmed(null);
        router.refresh();
        return;
      }

      if ("conflict" in result && result.conflict) {
        setConflict(result.conflict);
        const confirmedFormData = new FormData();
        formData.forEach((value, key) => confirmedFormData.set(key, value as string));
        confirmedFormData.set("confirmOverlap", "true");
        setRetryWithOverlapConfirmed(() => () => submitCustomCourse(confirmedFormData));
        return;
      }

      setConflict(null);
      setFeedback({ ok: false, message: result.message });
    });
  }

  function handleSaveCustomCourse() {
    const formData = new FormData();
    formData.set("title", customTitle);
    if (editingCustomId) formData.set("customCourseId", editingCustomId);
    formData.set("scheduleSlots", JSON.stringify(customSlots.map((slot) => ({
      dayOfWeek: slot.day,
      startTime: slot.startTime,
      endTime: slot.endTime,
      classroom: slot.classroom,
    }))));
    submitCustomCourse(formData);
  }

  function handleConfirmOverlap() {
    retryWithOverlapConfirmed?.();
  }

  function handleEditConflictingTime() {
    setConflict(null);
    setRetryWithOverlapConfirmed(null);
  }

  function beginCustomCourseEdit(course: StudentCourseRecord) {
    if (!course.is_custom || !course.custom_course_id) return;
    setEditingCustomId(course.custom_course_id);
    setCustomTitle(course.course.name);
    const slots = (course.schedule_slots ?? []).map((slot) => ({
      day: slot.day_of_week,
      startTime: slot.start_time.slice(0, 5),
      endTime: slot.end_time.slice(0, 5),
      classroom: slot.classroom ?? "",
    }));
    setCustomSlots(slots.length ? slots : [{ day: days[0], startTime: "09:00", endTime: "10:15", classroom: "" }]);
  }

  function handleRemove(enrollmentId: string) {
    setFeedback(null);

    const record = timetableCourses.find((item) => item.id === enrollmentId);
    if (record?.is_custom && record.custom_course_id) {
      const formData = new FormData();
      formData.set("customCourseId", record.custom_course_id);
      startTransition(async () => {
        const result = await removeCustomCourseFromSchedule(formData);
        setFeedback({ ok: result.ok, message: result.message });
        if (result.ok) {
          setTimetableCourses(removeTimetableCourse(timetableCourses, enrollmentId));
          router.refresh();
        }
      });
      return;
    }

    if (isLocalTimetableCourse(enrollmentId)) {
      setTimetableCourses(removeTimetableCourse(timetableCourses, enrollmentId));
      setFeedback({ ok: true, message: "시간표에서 제거했습니다." });
      return;
    }

    const formData = new FormData();
    formData.set("enrollmentId", enrollmentId);
    startTransition(async () => {
      const result = await removeCourseFromSchedule(formData);
      setFeedback({ ok: result.ok, message: result.message });
      if (result.ok) {
        setTimetableCourses(removeTimetableCourse(timetableCourses, enrollmentId));
        router.refresh();
      }
    });
  }

  const { timetableHours, timetableStartHour } = useMemo(() => {
    const startHours = timetableItems
      .map((item) => toMinutes(item.start_time))
      .filter((value): value is number => value !== null)
      .map((value) => Math.floor(value / 60));
    const endHours = timetableItems
      .map((item) => toMinutes(item.end_time))
      .filter((value): value is number => value !== null)
      .map((value) => Math.ceil(value / 60));
    const startHour = Math.min(9, ...startHours);
    const endHour = Math.max(19, startHour + 1, ...endHours);

    return {
      timetableStartHour: startHour,
      timetableHours: Array.from({ length: endHour - startHour }, (_, index) => startHour + index),
    };
  }, [timetableItems]);

  const timetableGridColumns = `${TIMETABLE_TIME_COLUMN} repeat(${days.length}, minmax(0, 1fr))`;

  // Position helper for grid
  const getBlockMetrics = (startTimeStr: string, endTimeStr: string) => {
    const start = toMinutes(startTimeStr);
    const end = toMinutes(endTimeStr);
    if (start === null || end === null) return null;

    return {
      top: start - timetableStartHour * 60,
      height: end - start,
    };
  };

  const loadTodos = useCallback(() => {
    if (typeof window === "undefined") return;

    try {
      const storedTodos = window.localStorage.getItem(STUDENT_TODO_STORAGE_KEY);
      const storedDone = window.localStorage.getItem(STUDENT_TODO_DONE_STORAGE_KEY);
      const parsedTodos = storedTodos ? (JSON.parse(storedTodos) as unknown) : [];
      const parsedDone = storedDone ? (JSON.parse(storedDone) as string[]) : [];
      const normalizedTodos = normalizeStoredTodos(parsedTodos);
      const normalizedDoneIds = Array.isArray(parsedDone) ? parsedDone : [];
      const reconciledTodos = normalizedTodos.map((todo) => {
        const isCompleted = Boolean(todo.completed) || normalizedDoneIds.includes(todo.id);
        return { ...todo, completed: isCompleted };
      });
      const reconciledDoneIds = Array.from(
        new Set([
          ...normalizedDoneIds,
          ...reconciledTodos.filter((todo) => todo.completed).map((todo) => todo.id),
        ]),
      );

      setTodos(reconciledTodos);
      setDoneIds(reconciledDoneIds);
    } catch {
      setTodos([]);
      setDoneIds([]);
    } finally {
      setIsTodoLoaded(true);
      setIsDoneLoaded(true);
    }
  }, []);

  useEffect(() => {
    loadTodos();

    if (typeof window === "undefined") return;

    window.addEventListener("pacemate:student-todos-updated", loadTodos);
    window.addEventListener("storage", loadTodos);

    return () => {
      window.removeEventListener("pacemate:student-todos-updated", loadTodos);
      window.removeEventListener("storage", loadTodos);
    };
  }, [loadTodos]);

  useEffect(() => {
    if (typeof window === "undefined" || !isTodoLoaded) return;
    window.localStorage.setItem(
      STUDENT_TODO_STORAGE_KEY,
      JSON.stringify(todos.map((todo) => normalizeStoredTodo(todo))),
    );
  }, [todos, isTodoLoaded]);

  useEffect(() => {
    if (typeof window === "undefined" || !isDoneLoaded) return;
    window.localStorage.setItem(STUDENT_TODO_DONE_STORAGE_KEY, JSON.stringify(doneIds));
  }, [doneIds, isDoneLoaded]);

  const currentTabPosts = useMemo(() => {
    switch (activeCommunityTab) {
      case "my": return myPosts;
      case "scrap": return scrapedPosts;
      case "comment": return commentedPosts;
      case "like": return likedPosts;
    }
  }, [activeCommunityTab, myPosts, scrapedPosts, commentedPosts, likedPosts]);

  const sortedTodos = useMemo(() => {
    return [...todos].sort((a, b) => {
      const aTime = a.dueDate ? new Date(a.dueDate).getTime() : Number.POSITIVE_INFINITY;
      const bTime = b.dueDate ? new Date(b.dueDate).getTime() : Number.POSITIVE_INFINITY;
      return aTime - bTime;
    });
  }, [todos]);

  const activeTodos = useMemo(() => {
    return sortedTodos.filter((todo) => !(todo.completed ?? false) && !doneIds.includes(todo.id));
  }, [sortedTodos, doneIds]);

  function resetTodoForm() {
    setTodoTitle("");
    setTodoDueDate(getLocalDateKey(new Date()));
    setTodoCategory("과제");
    setTodoEditId(null);
  }

  function persistTodoState(nextTodos: StudentTodoItem[], nextDoneIds: string[]) {
    if (typeof window === "undefined") return;

    window.localStorage.setItem(STUDENT_TODO_STORAGE_KEY, JSON.stringify(nextTodos.map((todo) => normalizeStoredTodo(todo))));
    window.localStorage.setItem(STUDENT_TODO_DONE_STORAGE_KEY, JSON.stringify(nextDoneIds));
    window.dispatchEvent(new Event("pacemate:student-todos-updated"));
  }

  function handleSaveTodo() {
    const trimmedTitle = todoTitle.trim();
    if (!trimmedTitle) return;

    let nextTodos: StudentTodoItem[];

    if (todoEditId) {
      nextTodos = todos.map((todo) =>
        todo.id === todoEditId
          ? {
              ...todo,
              title: trimmedTitle,
              dueDate: todoDueDate,
              category: todoCategory,
              type: getTodoTypeFromCategory(todoCategory),
              source: "manual",
              completed: todo.completed ?? false,
            }
          : todo,
      );
    } else {
      nextTodos = [
        {
          id: `manual-${Date.now()}`,
          title: trimmedTitle,
          description: `${todoCategory} 일정입니다.`,
          type: getTodoTypeFromCategory(todoCategory),
          dueDate: todoDueDate,
          category: todoCategory,
          source: "manual",
          completed: false,
        },
        ...todos,
      ];
    }

    setTodos(nextTodos);
    persistTodoState(nextTodos, doneIds);
    resetTodoForm();
  }

  function handleEditTodo(todo: StudentTodoItem) {
    setTodoEditId(todo.id);
    setTodoTitle(todo.title);
    setTodoDueDate(todo.dueDate ?? getLocalDateKey(new Date()));
    setTodoCategory(todo.category ?? "개인");
  }

  function handleDeleteTodo(id: string) {
    const nextTodos = todos.filter((todo) => todo.id !== id);
    const nextDoneIds = doneIds.filter((todoId) => todoId !== id);

    setTodos(nextTodos);
    setDoneIds(nextDoneIds);
    persistTodoState(nextTodos, nextDoneIds);
  }

  function toggleTodoCompletion(id: string) {
    const targetTodo = todos.find((todo) => todo.id === id);
    if (!targetTodo) return;

    const nextCompleted = !(targetTodo.completed ?? false);
    const nextTodos = todos.map((todo) => (todo.id === id ? { ...normalizeStoredTodo(todo), completed: nextCompleted } : todo));
    const nextDoneIds = nextCompleted
      ? Array.from(new Set([...doneIds, id]))
      : doneIds.filter((todoId) => todoId !== id);

    setTodos(nextTodos);
    setDoneIds(nextDoneIds);
    persistTodoState(nextTodos, nextDoneIds);
  }

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-8 pb-20 md:pb-8">
      <MyPageSectionTabs activeTab={activeTab} onChange={setActiveTab} />
      {/* SECTION 1: 2D Timetable */}
      <section className={`bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden ${activeTab === "all" || activeTab === "timetable" ? "" : "hidden"}`}>
        <div className="p-5 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-xl font-bold flex items-center gap-2">
            내 시간표
            <span className="text-sm font-medium text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">{timetableCourses.length}과목</span>
          </h2>
        </div>
        {feedback ? (
          <div
            className={`mx-5 mt-4 rounded-xl border px-4 py-3 text-sm font-medium ${
              feedback.ok
                ? "border-emerald-100 bg-emerald-50 text-emerald-700"
                : "border-red-100 bg-red-50 text-red-600"
            }`}
            role="status"
          >
            {feedback.message}
          </div>
        ) : null}
        
        <div className="w-full min-w-0 overflow-hidden p-2 sm:p-5">
          <div
            className="relative w-full min-w-0 overflow-hidden rounded-lg bg-gray-50/30 shadow-inner"
            style={{ contain: "layout paint" }}
          >
            {/* Header Row */}
            <div className="grid h-10 border-b border-gray-100 bg-gray-50" style={{ gridTemplateColumns: timetableGridColumns }}>
              <div className="border-r border-gray-100" />
              {days.map((d) => (
                <div key={d} className="flex min-w-0 items-center justify-center border-r border-gray-100 px-0.5 text-center text-[11px] font-semibold text-gray-600 last:border-r-0 sm:px-1 sm:text-sm">
                  {d}
                </div>
              ))}
            </div>

            {/* Grid Body */}
            <div className="relative" style={{ height: `${timetableHours.length * 60}px` }}>
              {/* Horizontal Lines & Time Labels */}
              {timetableHours.map((hour, idx) => (
                <div key={hour} className="absolute grid w-full" style={{ top: `${idx * 60}px`, height: "60px", gridTemplateColumns: timetableGridColumns }}>
                  <div className="flex items-start justify-center border-r border-gray-100 pt-2">
                    <span className="text-[10px] font-medium text-gray-400 sm:text-xs">{hour}</span>
                  </div>
                  {days.map((d) => (
                    <div key={`${hour}-${d}`} className="min-w-0 border-b border-r border-dotted border-gray-100 last:border-r-0" />
                  ))}
                </div>
              ))}

              {/* Course Blocks */}
              {timetableItems.map((item, index) => {
                if (!item.schedule_day || !item.start_time || !item.end_time) return null;
                const dayIndex = days.indexOf(item.schedule_day);
                if (dayIndex === -1) return null;

                const colorClass = blockColors[index % blockColors.length];
                const blockMetrics = getBlockMetrics(item.start_time, item.end_time);
                if (!blockMetrics || blockMetrics.height <= 0) return null;

                return (
                  <div 
                    key={item.id}
                    className="absolute min-w-0"
                    style={{
                      top: `${blockMetrics.top}px`,
                      height: `${blockMetrics.height}px`,
                      left: `calc(${TIMETABLE_TIME_COLUMN} + ${dayIndex} * ((100% - ${TIMETABLE_TIME_COLUMN}) / ${days.length}))`,
                      width: `calc((100% - ${TIMETABLE_TIME_COLUMN}) / ${days.length})`,
                    }}
                  >
                    <TimetableCourseCell
                      item={item}
                      colorClass={colorClass}
                      onRemove={() => handleRemove(item.parentId)}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 2: Course Search & Add */}
      <section className={`bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden ${activeTab === "all" || activeTab === "timetable" ? "" : "hidden"}`}>
        <div className="p-5 border-b border-gray-100 flex items-center gap-3">
          <CalendarPlus className="text-emerald-500" size={20} />
          <h2 className="text-xl font-bold">시간표 과목 검색 및 등록</h2>
        </div>
        
        <div className="p-5">
          <div className="relative mb-6">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input
              type="text"
              placeholder="과목명, 코드, 분류 검색"
              className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <div className="flex flex-col md:flex-row gap-6">
            {/* Search Results List */}
            <div className="flex-1 border border-gray-200 rounded-xl overflow-hidden h-[300px] overflow-y-auto bg-gray-50/50">
              {filteredCourses.map((course) => (
                <button
                  key={course.id}
                  onClick={() => setSelectedCourseId(course.id)}
                  className={`w-full text-left p-4 border-b border-gray-100 transition-colors last:border-b-0 hover:bg-white flex items-center justify-between ${
                    selectedCourseId === course.id ? "bg-white border-l-4 border-l-emerald-500" : ""
                  }`}
                >
                  <div>
                    <div className="font-bold text-gray-800">{course.name}</div>
                    <div className="text-xs text-gray-500 mt-1 flex gap-2">
                      <span>{course.code}</span>
                      <span>·</span>
                      <span>{course.credit}학점</span>
                      <span>·</span>
                      <span>{course.category}</span>
                    </div>
                  </div>
                  {scheduledCourseIds.has(course.id) && (
                    <span className="text-[10px] bg-gray-100 text-gray-500 px-2 py-1 rounded-md font-medium">등록됨</span>
                  )}
                </button>
              ))}
            </div>

            {/* Add Course Form */}
            <div className="w-full md:w-80 bg-white border border-gray-200 rounded-xl p-5 flex flex-col">
              <h3 className="font-bold text-gray-800 mb-4 pb-3 border-b border-gray-100">선택 과목 상세 설정</h3>
              
              <div className="space-y-4 flex-1">
                <div className="bg-emerald-50/50 p-3 rounded-lg border border-emerald-100 mb-2">
                  <div className="font-bold text-emerald-800 text-sm">{selectedCourse?.name ?? "과목을 선택하세요"}</div>
                  <div className="text-xs text-emerald-600/80 mt-1 line-clamp-2">{selectedCourse?.description ?? "설명이 없습니다."}</div>
                </div>

                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-gray-500 mb-1">요일</label>
                    <select 
                      value={day} 
                      onChange={(e) => setDay(e.target.value)}
                      className="w-full p-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:border-emerald-500"
                    >
                      {days.map(d => <option key={d}>{d}</option>)}
                    </select>
                  </div>
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-gray-500 mb-1">강의실</label>
                    <input 
                      type="text" 
                      value={classroom} 
                      onChange={(e) => setClassroom(e.target.value)}
                      placeholder="강의실 명"
                      className="w-full p-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>

                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-gray-500 mb-1">시작 시간</label>
                    <input 
                      type="time" 
                      value={startTime} 
                      onChange={(e) => setStartTime(e.target.value)}
                      className="w-full p-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-gray-500 mb-1">종료 시간</label>
                    <input 
                      type="time" 
                      value={endTime} 
                      onChange={(e) => setEndTime(e.target.value)}
                      className="w-full p-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>

                {registerFormConflicts.length > 0 ? (
                  <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
                    이 시간에 {registerFormConflicts[0].existing.label} 과목이 있어요.
                  </p>
                ) : null}
              </div>

              <details className="mt-3 rounded-xl bg-emerald-50/70 p-3 text-xs text-emerald-900">
                <summary className="cursor-pointer font-semibold">여러 수업 시간 입력</summary>
                <p className="mt-2 text-emerald-700">강의계획서 시간이 없을 때 JSON 배열로 요일·시간·강의실을 추가할 수 있습니다.</p>
                <textarea
                  value={regularSlotsJson}
                  onChange={(event) => setRegularSlotsJson(event.target.value)}
                  placeholder={'[{"dayOfWeek":"월","startTime":"09:00","endTime":"10:15","classroom":"A101"},{"dayOfWeek":"수","startTime":"09:00","endTime":"10:15","classroom":"A101"}]'}
                  className="mt-2 min-h-20 w-full rounded-lg border border-emerald-100 bg-white p-2 font-mono text-[11px] text-slate-700 outline-none focus:border-emerald-400"
                />
              </details>

              <button
                onClick={handleAddCourse}
                disabled={isPending || !selectedCourse || (selectedCourse ? scheduledCourseIds.has(selectedCourse.id) : false)}
                className="mt-4 w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-300 disabled:text-gray-500 text-white rounded-lg font-medium text-sm transition-colors flex items-center justify-center gap-2 shadow-sm"
              >
                <CalendarPlus size={16} />
                <span>{selectedCourse && scheduledCourseIds.has(selectedCourse.id) ? "이미 시간표에 등록됨" : "시간표에 추가하기"}</span>
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className={`rounded-2xl bg-sky-50/70 p-5 shadow-sm ${activeTab === "all" || activeTab === "timetable" ? "" : "hidden"}`}>
        <div className="mb-4 flex items-center gap-3">
          <CalendarPlus className="text-sky-600" size={20} />
          <div>
            <h2 className="text-lg font-bold text-slate-800">직접 입력 수업</h2>
            <p className="text-xs text-slate-500">시간표에만 표시되며 수강·로드맵 데이터에는 추가되지 않습니다.</p>
          </div>
        </div>
        <div className="space-y-3">
          <input
            value={customTitle}
            onChange={(event) => setCustomTitle(event.target.value)}
            placeholder="수업 이름"
            className="w-full rounded-xl border border-sky-100 bg-white px-3 py-2.5 text-sm outline-none focus:border-sky-400"
          />
          {customSlots.map((slot, index) => (
            <div key={index}>
              <div className="grid gap-2 rounded-xl bg-white/90 p-3 shadow-sm sm:grid-cols-[0.8fr_1fr_1fr_1.2fr_auto]">
                <select value={slot.day} onChange={(event) => setCustomSlots((slots) => slots.map((item, slotIndex) => slotIndex === index ? { ...item, day: event.target.value } : item))} className="rounded-lg border border-sky-100 px-2 py-2 text-sm">
                  {days.map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
                <input type="time" value={slot.startTime} onChange={(event) => setCustomSlots((slots) => slots.map((item, slotIndex) => slotIndex === index ? { ...item, startTime: event.target.value } : item))} className="rounded-lg border border-sky-100 px-2 py-2 text-sm" />
                <input type="time" value={slot.endTime} onChange={(event) => setCustomSlots((slots) => slots.map((item, slotIndex) => slotIndex === index ? { ...item, endTime: event.target.value } : item))} className="rounded-lg border border-sky-100 px-2 py-2 text-sm" />
                <input value={slot.classroom} onChange={(event) => setCustomSlots((slots) => slots.map((item, slotIndex) => slotIndex === index ? { ...item, classroom: event.target.value } : item))} placeholder="강의실" className="rounded-lg border border-sky-100 px-2 py-2 text-sm" />
                <button type="button" disabled={customSlots.length === 1} onClick={() => setCustomSlots((slots) => slots.filter((_, slotIndex) => slotIndex !== index))} className="rounded-lg px-2 text-sm text-rose-600 disabled:text-slate-300">삭제</button>
              </div>
              {customSlotConflicts[index]?.length > 0 ? (
                <p className="mt-1 rounded-lg bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700">
                  이 시간에 {customSlotConflicts[index][0].existing.label} 과목이 있어요.
                </p>
              ) : null}
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setCustomSlots((slots) => [...slots, { day: days[0], startTime: "09:00", endTime: "10:15", classroom: "" }])} className="rounded-lg bg-white px-3 py-2 text-sm font-medium text-sky-700 shadow-sm hover:bg-sky-100">시간 추가</button>
            <button type="button" disabled={isPending || !customTitle.trim()} onClick={handleSaveCustomCourse} className="rounded-lg bg-sky-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-sky-700 disabled:bg-slate-300">{editingCustomId ? "직접 수업 수정" : "직접 수업 저장"}</button>
            {editingCustomId ? <button type="button" onClick={() => { setEditingCustomId(null); setCustomTitle(""); setCustomSlots([{ day: days[0], startTime: "09:00", endTime: "10:15", classroom: "" }]); }} className="rounded-lg px-3 py-2 text-sm text-slate-500 hover:bg-white">취소</button> : null}
          </div>
          {timetableCourses.filter((course) => course.is_custom).map((course) => (
            <div key={course.id} className="flex items-center justify-between rounded-xl bg-white/80 px-3 py-2 shadow-sm">
              <span className="text-sm font-medium text-slate-700">{course.course.name}</span>
              <button type="button" onClick={() => beginCustomCourseEdit(course)} className="text-sm font-medium text-sky-700">수정</button>
            </div>
          ))}
        </div>
      </section>

      {/* SECTION 3: To-do Management */}
      <section id="todo" className={`bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden ${activeTab === "all" || activeTab === "todo" ? "" : "hidden"}`}>
        <div className="p-5 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold">To-do 관리</h2>
            <p className="text-sm text-gray-500 mt-1">오늘의 할 일을 추가하고, 완료 상태를 관리해 보세요.</p>
          </div>
          <span className="text-sm font-medium text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-full">{todos.length}개</span>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid gap-3 md:grid-cols-[1.3fr_0.8fr_0.8fr_auto]">
            <input
              type="text"
              value={todoTitle}
              onChange={(e) => setTodoTitle(e.target.value)}
              placeholder="할 일 제목"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
            />
            <input
              type="date"
              value={todoDueDate}
              onChange={(e) => setTodoDueDate(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
            />
            <select
              value={todoCategory}
              onChange={(e) => setTodoCategory(e.target.value as StudentTodoCategory)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
            >
              <option value="과제">과제</option>
              <option value="시험">시험</option>
              <option value="상담">상담</option>
              <option value="공지">공지</option>
              <option value="개인">개인</option>
            </select>
            <button
              type="button"
              onClick={handleSaveTodo}
              className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium text-sm transition-colors"
            >
              {todoEditId ? "수정하기" : "추가하기"}
            </button>
          </div>

          {todoEditId ? (
            <button
              type="button"
              onClick={resetTodoForm}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              취소
            </button>
          ) : null}

          <div className="space-y-3">
            {activeTodos.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-6 text-center text-sm text-gray-500">
                아직 등록된 To-do가 없습니다.
              </div>
            ) : (
              activeTodos.map((todo) => {
                const done = Boolean(todo.completed) || doneIds.includes(todo.id);
                return (
                  <div key={todo.id} className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 flex-1">
                        <button
                          type="button"
                          onClick={() => toggleTodoCompletion(todo.id)}
                          className="mt-0.5 shrink-0 text-gray-400 hover:text-emerald-600"
                        >
                          {done ? <CheckCircle2 size={18} className="text-emerald-600" /> : <Circle size={18} />}
                        </button>
                        <div className="min-w-0">
                          <p className={`font-semibold text-sm ${done ? "text-gray-500 line-through" : "text-gray-900"}`}>
                            {todo.title}
                          </p>
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
                            <span className="rounded-full bg-gray-100 px-2 py-1">{todo.category ?? "개인"}</span>
                            {todo.dueDate ? <span>마감일 {todo.dueDate}</span> : null}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleEditTodo(todo)}
                          className="text-sm text-emerald-600 hover:text-emerald-700"
                        >
                          수정
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteTodo(todo.id)}
                          className="text-sm text-red-500 hover:text-red-600"
                        >
                          삭제
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </section>

      {/* SECTION 4: Community Tabs */}
      <section className={`bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden ${activeTab === "all" || activeTab === "community" ? "" : "hidden"}`}>
        <div className="border-b border-gray-100 px-2 pt-2 flex overflow-x-auto hide-scrollbar">
          <button 
            onClick={() => setActiveCommunityTab("my")}
            className={`px-4 py-3 text-sm font-bold border-b-2 whitespace-nowrap transition-colors flex items-center gap-2 ${activeCommunityTab === "my" ? "border-emerald-600 text-emerald-600" : "border-transparent text-gray-500 hover:text-gray-800"}`}
          >
            <FileText size={16} /> 내가 쓴 글 ({myPosts.length})
          </button>
          <button 
            onClick={() => setActiveCommunityTab("scrap")}
            className={`px-4 py-3 text-sm font-bold border-b-2 whitespace-nowrap transition-colors flex items-center gap-2 ${activeCommunityTab === "scrap" ? "border-emerald-600 text-emerald-600" : "border-transparent text-gray-500 hover:text-gray-800"}`}
          >
            <Bookmark size={16} /> 스크랩 ({scrapedPosts.length})
          </button>
          <button 
            onClick={() => setActiveCommunityTab("comment")}
            className={`px-4 py-3 text-sm font-bold border-b-2 whitespace-nowrap transition-colors flex items-center gap-2 ${activeCommunityTab === "comment" ? "border-emerald-600 text-emerald-600" : "border-transparent text-gray-500 hover:text-gray-800"}`}
          >
            <MessageCircle size={16} /> 댓글 단 글 ({commentedPosts.length})
          </button>
          <button 
            onClick={() => setActiveCommunityTab("like")}
            className={`px-4 py-3 text-sm font-bold border-b-2 whitespace-nowrap transition-colors flex items-center gap-2 ${activeCommunityTab === "like" ? "border-emerald-600 text-emerald-600" : "border-transparent text-gray-500 hover:text-gray-800"}`}
          >
            <ThumbsUp size={16} /> 좋아요 단 글 ({likedPosts.length})
          </button>
        </div>

        <div className="p-0">
          {currentTabPosts.length > 0 ? (
            <div className="divide-y divide-gray-100">
              {currentTabPosts.map((post) => (
                <Link 
                  href={`/community?post=${post.id}`} 
                  key={post.id}
                  className="block p-5 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex justify-between items-start mb-2">
                    <h3 className="font-bold text-gray-900">{post.title}</h3>
                    <span className="text-[10px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full whitespace-nowrap">{post.course?.name ?? "자유게시판"}</span>
                  </div>
                  <p className="text-sm text-gray-500 line-clamp-2 mb-3">{post.content}</p>
                  <div className="flex items-center gap-4 text-xs text-gray-400">
                    <span className="flex items-center gap-1"><ThumbsUp size={12} className={post.is_liked ? "text-emerald-500" : ""} /> {post.likes}</span>
                    <span className="flex items-center gap-1"><MessageCircle size={12} /> {post.comments}</span>
                    <span className="flex items-center gap-1"><Bookmark size={12} className={post.is_scrapped ? "text-emerald-500" : ""} /> {post.scraps}</span>
                    <span>·</span>
                    <span>{new Date(post.created_at).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })}</span>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="p-10 text-center text-gray-400 flex flex-col items-center">
              <MessageSquareText size={32} className="mb-3 opacity-50" />
              <p>해당하는 게시글이 없습니다.</p>
            </div>
          )}
        </div>
      </section>

      <ScheduleConflictDialog
        conflict={conflict}
        onOpenChange={(open) => {
          if (!open) {
            setConflict(null);
            setRetryWithOverlapConfirmed(null);
          }
        }}
        onConfirm={handleConfirmOverlap}
        onEditTime={handleEditConflictingTime}
        isPending={isPending}
      />
    </div>
  );
}
