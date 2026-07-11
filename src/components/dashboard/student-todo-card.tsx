"use client";

import Link from "next/link";
import { AlertCircle, CalendarClock, CheckCircle2, Circle, ClipboardList, GraduationCap } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

export const STUDENT_TODO_STORAGE_KEY = "pacemate_student_todos";
export const STUDENT_TODO_DONE_STORAGE_KEY = "pacemate_student_todo_done";

export type StudentTodoCategory = "과제" | "시험" | "상담" | "공지" | "개인";
export type StudentTodoItem = {
  id: string;
  title: string;
  description: string;
  type: "assignment" | "exam" | "counseling" | "notice" | "personal";
  courseName?: string | null;
  metaLabel?: string | null;
  metaValue?: string | null;
  linkHref?: string | null;
  linkLabel?: string | null;
  source?: "auto" | "manual";
  dueDate?: string | null;
  category?: StudentTodoCategory | null;
  completed?: boolean;
};

export function getLocalDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getTodoTypeFromCategory(category?: string | null): StudentTodoItem["type"] {
  switch (category) {
    case "과제":
      return "assignment";
    case "시험":
      return "exam";
    case "상담":
      return "counseling";
    case "공지":
      return "notice";
    default:
      return "personal";
  }
}

function normalizeTodoCategory(category?: string | null): StudentTodoCategory {
  if (category === "과제" || category === "시험" || category === "상담" || category === "공지" || category === "개인") {
    return category;
  }

  return "개인";
}

export function normalizeStoredTodo(todo: Partial<StudentTodoItem> | null | undefined): StudentTodoItem {
  const category = normalizeTodoCategory(todo?.category ?? undefined);
  const dueDate =
    todo?.dueDate ??
    (todo as { date?: string | null } | undefined)?.date ??
    (todo as { deadline?: string | null } | undefined)?.deadline ??
    (todo as { todoDate?: string | null } | undefined)?.todoDate ??
    null;

  return {
    id: todo?.id ?? `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: todo?.title ?? todo?.description ?? "새 할 일",
    description: todo?.description ?? `${category} 일정입니다.`,
    type: todo?.type ?? getTodoTypeFromCategory(category),
    courseName: todo?.courseName ?? null,
    metaLabel: todo?.metaLabel ?? null,
    metaValue: todo?.metaValue ?? null,
    linkHref: todo?.linkHref ?? null,
    linkLabel: todo?.linkLabel ?? null,
    source: todo?.source === "auto" ? "auto" : "manual",
    dueDate,
    category,
    completed: Boolean(todo?.completed),
  };
}

export function normalizeStoredTodos(rawTodos: unknown): StudentTodoItem[] {
  if (!Array.isArray(rawTodos)) return [];
  return rawTodos.map((todo) => normalizeStoredTodo(todo as Partial<StudentTodoItem>));
}

const typeMeta: Record<StudentTodoItem["type"], { label: string; className: string; icon: typeof ClipboardList }> = {
  assignment: {
    label: "과제",
    className: "border-amber-200 bg-amber-50 text-amber-700",
    icon: ClipboardList,
  },
  exam: {
    label: "시험/퀴즈",
    className: "border-violet-200 bg-violet-50 text-violet-700",
    icon: AlertCircle,
  },
  counseling: {
    label: "상담",
    className: "border-sky-200 bg-sky-50 text-sky-700",
    icon: GraduationCap,
  },
  notice: {
    label: "공지",
    className: "border-emerald-200 bg-emerald-50 text-emerald-700",
    icon: CalendarClock,
  },
  personal: {
    label: "개인",
    className: "border-slate-200 bg-slate-50 text-slate-700",
    icon: ClipboardList,
  },
};

export function StudentTodoCard({ items }: { items: StudentTodoItem[] }) {
  const [manualTodos, setManualTodos] = useState<StudentTodoItem[]>([]);
  const [doneIds, setDoneIds] = useState<string[]>([]);
  const [hasLoadedTodos, setHasLoadedTodos] = useState(false);

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

      setManualTodos(reconciledTodos);
      setDoneIds(reconciledDoneIds);
    } catch {
      setManualTodos([]);
      setDoneIds([]);
    } finally {
      setHasLoadedTodos(true);
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
    if (typeof window === "undefined" || !hasLoadedTodos) return;
    window.localStorage.setItem(STUDENT_TODO_STORAGE_KEY, JSON.stringify(manualTodos.map((todo) => normalizeStoredTodo(todo))));
  }, [manualTodos, hasLoadedTodos]);

  useEffect(() => {
    if (typeof window === "undefined" || !hasLoadedTodos) return;
    window.localStorage.setItem(STUDENT_TODO_DONE_STORAGE_KEY, JSON.stringify(doneIds));
  }, [doneIds, hasLoadedTodos]);

  const toggleDone = (id: string) => {
    const targetTodo = manualTodos.find((todo) => todo.id === id);
    const nextCompleted = targetTodo ? !targetTodo.completed : true;
    const nextTodos = manualTodos.map((todo) => (todo.id === id ? { ...normalizeStoredTodo(todo), completed: nextCompleted } : todo));
    const nextDoneIds = nextCompleted
      ? Array.from(new Set([...doneIds, id]))
      : doneIds.filter((todoId) => todoId !== id);

    setManualTodos(nextTodos);
    setDoneIds(nextDoneIds);

    if (typeof window !== "undefined") {
      window.localStorage.setItem(STUDENT_TODO_STORAGE_KEY, JSON.stringify(nextTodos.map((todo) => normalizeStoredTodo(todo))));
      window.localStorage.setItem(STUDENT_TODO_DONE_STORAGE_KEY, JSON.stringify(nextDoneIds));
      window.dispatchEvent(new Event("pacemate:student-todos-updated"));
    }
  };

  const todayKey = useMemo(() => getLocalDateKey(new Date()), []);

  const combinedItems = useMemo(() => {
    const visibleAutoItems = items
      .filter((item) => !doneIds.includes(item.id))
      .map((item) => ({ ...item, completed: false }));

    const manualItems = manualTodos
      .filter(
        (todo) =>
          todo.source === "manual" &&
          !todo.completed &&
          !doneIds.includes(todo.id) &&
          (!todo.dueDate || todo.dueDate >= todayKey),
      )
      .sort((a, b) => {
        if (!a.dueDate && !b.dueDate) return 0;
        if (!a.dueDate) return 1;
        if (!b.dueDate) return -1;
        return a.dueDate.localeCompare(b.dueDate);
      })
      .slice(0, 6)
      .map((todo) => ({
        ...todo,
        type: todo.type ?? getTodoTypeFromCategory(todo.category),
        description: todo.description || `${todo.category ?? "개인"} 일정입니다.`,
      }));

    return [...visibleAutoItems, ...manualItems];
  }, [items, manualTodos, todayKey, doneIds]);

  const completedCount = combinedItems.filter((item) => item.completed || doneIds.includes(item.id)).length;

  return (
    <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex min-w-0 items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-violet-50 text-violet-600 flex items-center justify-center">
            <CheckCircle2 size={18} strokeWidth={2.5} />
          </div>
          <div>
            <h3 className="font-bold text-gray-800 text-[15px]">오늘의 To-do</h3>
            <p className="text-[11px] text-gray-400">공지·상담 데이터와 직접 등록한 할 일이 함께 표시됩니다.</p>
          </div>
        </div>
        <Link href="/mypage#todo" className="shrink-0 text-right text-[11px] font-semibold text-emerald-600 hover:text-emerald-700">
          마이페이지에서 관리
        </Link>
      </div>

      {combinedItems.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-5 text-center">
          <p className="text-sm font-medium text-gray-600">표시할 To-do 항목이 없습니다.</p>
          <p className="mt-1 text-[11px] text-gray-400">교수 공지나 상담 신청, 또는 오늘 등록한 할 일을 확인해 보세요.</p>
        </div>
      ) : (
        <>
          <div className="mb-3 text-[11px] font-medium text-gray-500">
            {completedCount}/{combinedItems.length}
          </div>
          <ul className="space-y-3">
            {combinedItems.map((item) => {
              const done = doneIds.includes(item.id);
              const meta = typeMeta[item.type];
              const Icon = meta.icon;

              return (
                <li
                  key={item.id}
                  className={`rounded-2xl border p-4 transition-colors ${
                    done ? "border-gray-200 bg-gray-50" : "border-gray-100 bg-white"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <button
                      type="button"
                      onClick={() => toggleDone(item.id)}
                      className="mt-0.5 shrink-0 text-gray-400 hover:text-violet-600"
                      aria-label={`${item.title} 완료 상태 변경`}
                    >
                      {done ? <CheckCircle2 size={18} className="text-violet-600" /> : <Circle size={18} />}
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${meta.className}`}>
                          <Icon size={12} />
                          {meta.label}
                        </span>
                        {item.courseName ? (
                          <span className="text-[11px] text-gray-500">{item.courseName}</span>
                        ) : null}
                      </div>

                      <p className={`mt-2 break-words text-sm font-semibold ${done ? "text-gray-500 line-through" : "text-gray-900"}`}>
                        {item.title}
                      </p>
                      <p className="mt-1 break-words text-xs leading-5 text-gray-500">{item.description}</p>

                      {(item.metaLabel || item.metaValue) && (
                        <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-gray-500">
                          {item.metaLabel ? <span>{item.metaLabel}</span> : null}
                          {item.metaValue ? <span className="font-medium text-gray-700">{item.metaValue}</span> : null}
                        </div>
                      )}

                      {item.linkHref ? (
                        <Link
                          href={item.linkHref}
                          className="mt-3 inline-flex items-center text-sm font-semibold text-emerald-600 hover:text-emerald-700"
                        >
                          {item.linkLabel ?? "바로가기"}
                        </Link>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
