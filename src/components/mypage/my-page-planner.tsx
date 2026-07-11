"use client";

import Link from "next/link";
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
  removeCourseFromSchedule,
  toggleFavoriteCourse,
} from "@/services/student-community.actions";
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

type MyPagePlannerProps = {
  courses: CourseRecord[];
  myCourses: StudentCourseRecord[];
  myPosts: CommunityPostRecord[];
  scrapedPosts: CommunityPostRecord[];
  commentedPosts: CommunityPostRecord[];
  likedPosts: CommunityPostRecord[];
};

const days = ["월", "화", "수", "목", "금"];
const HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18];

// 5 Pastel colors for timetable blocks
const blockColors = [
  "bg-emerald-100 text-emerald-800 border-emerald-200",
  "bg-teal-100 text-teal-800 border-teal-200",
  "bg-cyan-100 text-cyan-800 border-cyan-200",
  "bg-sky-100 text-sky-800 border-sky-200",
  "bg-green-100 text-green-800 border-green-200",
];

export function MyPagePlanner({
  courses,
  myCourses,
  myPosts,
  scrapedPosts,
  commentedPosts,
  likedPosts,
}: MyPagePlannerProps) {
  const [query, setQuery] = useState("");
  const [selectedCourseId, setSelectedCourseId] = useState(courses[0]?.id ?? "");
  const [day, setDay] = useState("월");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:15");
  const [classroom, setClassroom] = useState("");
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const [activeCommunityTab, setActiveCommunityTab] = useState<"my" | "scrap" | "comment" | "like">("my");
  const [todoTitle, setTodoTitle] = useState("");
  const [todoDueDate, setTodoDueDate] = useState(getLocalDateKey(new Date()));
  const [todoCategory, setTodoCategory] = useState<StudentTodoCategory>("과제");
  const [todoEditId, setTodoEditId] = useState<string | null>(null);
  const [todos, setTodos] = useState<StudentTodoItem[]>([]);
  const [doneIds, setDoneIds] = useState<string[]>([]);
  const [isTodoLoaded, setIsTodoLoaded] = useState(false);
  const [isDoneLoaded, setIsDoneLoaded] = useState(false);

  const selectedCourse = courses.find((course) => course.id === selectedCourseId) ?? courses[0];

  const filteredCourses = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return courses.filter((course) =>
      [course.name, course.code, course.category ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery),
    );
  }, [courses, query]);

  const scheduledCourseIds = new Set(myCourses.map((item) => item.course.id));

  function runAction(action: (formData: FormData) => Promise<{ message: string }>, formData: FormData) {
    setMessage("");
    startTransition(async () => {
      const result = await action(formData);
      setMessage(result.message);
    });
  }

  function handleAddCourse() {
    if (!selectedCourse) return;

    const formData = new FormData();
    formData.set("courseId", selectedCourse.id);
    formData.set("scheduleDay", day);
    formData.set("startTime", startTime);
    formData.set("endTime", endTime);
    formData.set("classroom", classroom || "강의실 미정");
    formData.set("isFavorite", "true");
    runAction(addCourseToSchedule, formData);
  }

  function handleRemove(enrollmentId: string) {
    const formData = new FormData();
    formData.set("enrollmentId", enrollmentId);
    runAction(removeCourseFromSchedule, formData);
  }

  // Position helper for grid
  const getBlockStyle = (startTimeStr: string, endTimeStr: string) => {
    const [startH, startM] = startTimeStr.split(":").map(Number);
    const [endH, endM] = endTimeStr.split(":").map(Number);
    const startMinutes = (startH - 9) * 60 + startM;
    const durationMinutes = (endH - startH) * 60 + (endM - startM);
    
    // 1 hour = 60px
    return {
      top: `${startMinutes + 40}px`, // +40px for header row offset inside the relative container
      height: `${durationMinutes}px`,
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
      {/* SECTION 1: 2D Timetable */}
      <section className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-5 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-xl font-bold flex items-center gap-2">
            내 시간표
            <span className="text-sm font-medium text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">{myCourses.length}과목</span>
          </h2>
        </div>
        
        <div className="p-5 overflow-x-auto">
          <div className="min-w-[600px] relative border border-gray-200 rounded-lg bg-gray-50/30">
            {/* Header Row */}
            <div className="flex h-10 border-b border-gray-200 bg-gray-50">
              <div className="w-14 border-r border-gray-200 flex-shrink-0" />
              {days.map((d) => (
                <div key={d} className="flex-1 border-r border-gray-200 text-center flex items-center justify-center font-medium text-gray-600 text-sm last:border-r-0">
                  {d}
                </div>
              ))}
            </div>

            {/* Grid Body */}
            <div className="relative" style={{ height: `${HOURS.length * 60}px` }}>
              {/* Horizontal Lines & Time Labels */}
              {HOURS.map((hour, idx) => (
                <div key={hour} className="absolute w-full flex" style={{ top: `${idx * 60}px`, height: '60px' }}>
                  <div className="w-14 border-r border-gray-200 flex-shrink-0 flex items-start justify-center pt-2">
                    <span className="text-xs text-gray-400 font-medium">{hour}</span>
                  </div>
                  {days.map((d) => (
                    <div key={`${hour}-${d}`} className="flex-1 border-r border-b border-gray-200 border-dotted last:border-r-0" />
                  ))}
                </div>
              ))}

              {/* Course Blocks */}
              {myCourses.map((item, index) => {
                if (!item.schedule_day || !item.start_time || !item.end_time) return null;
                const dayIndex = days.indexOf(item.schedule_day);
                if (dayIndex === -1) return null;

                const colorClass = blockColors[index % blockColors.length];
                const blockStyle = getBlockStyle(item.start_time, item.end_time);

                return (
                  <div 
                    key={item.id}
                    className={`absolute p-2 border rounded-md shadow-sm overflow-hidden group transition-transform hover:scale-[1.02] hover:z-10 ${colorClass}`}
                    style={{
                      top: `${parseInt(blockStyle.top) - 40}px`, // adjust because we are inside a relative container that doesn't include header
                      height: blockStyle.height,
                      left: `calc(3.5rem + ${dayIndex} * ((100% - 3.5rem) / 5))`,
                      width: `calc((100% - 3.5rem) / 5)`
                    }}
                  >
                    <div className="text-xs font-bold leading-tight mb-1 break-words">{item.course.name}</div>
                    <div className="text-[10px] opacity-80 flex flex-col gap-0.5">
                      <span>{item.classroom ?? "강의실 미정"}</span>
                    </div>
                    
                    {/* Delete overlay */}
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity rounded-md">
                      <button 
                        onClick={() => handleRemove(item.id)}
                        className="bg-white text-red-500 p-1.5 rounded-full shadow-md hover:bg-red-50"
                        title="과목 삭제"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 2: Course Search & Add */}
      <section className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
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
              </div>

              {message && <p className="text-sm text-red-500 mt-2 mb-2 font-medium">{message}</p>}

              <button
                onClick={handleAddCourse}
                disabled={isPending || !selectedCourse}
                className="mt-4 w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium text-sm transition-colors flex items-center justify-center gap-2 shadow-sm"
              >
                <CalendarPlus size={16} />
                <span>[+ 시간표에 추가]</span>
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 3: To-do Management */}
      <section id="todo" className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
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
      <section className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
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
                    <span>{new Date(post.created_at).toLocaleDateString()}</span>
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

    </div>
  );
}
