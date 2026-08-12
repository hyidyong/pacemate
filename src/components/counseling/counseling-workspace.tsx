"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, CalendarCheck, ChevronLeft, ChevronRight, Search, Send, UserRound } from "lucide-react";
import {
  cancelMyCounselingRequest,
  createCounselingRequest,
  reserveSuggestedCounseling,
} from "@/services/counseling.actions";
import {
  PACEMATE_TIME_ZONE,
  getCounselingLocalDateKey,
  getCounselingSlotId,
  resolveSelectedCounselingSlot,
} from "@/lib/counseling-slots";
import type {
  CounselingSlot,
  CounselingCourseOption,
  CounselingProfessor,
  StudentCounselingRequest,
} from "@/types/counseling";

type CounselingWorkspaceProps = {
  availableSlots: CounselingSlot[];
  courses: CounselingCourseOption[];
  professors: CounselingProfessor[];
  requests: StudentCounselingRequest[];
};

type CalendarDay = {
  date: Date;
  dateKey: string;
  dayNumber: number;
  isCurrentMonth: boolean;
  slots: CounselingSlot[];
};

const statusLabels: Record<StudentCounselingRequest["status"], string> = {
  pending: "승인 대기",
  approved: "승인 완료",
  rejected: "시간 조정",
  cancelled: "취소됨",
};

const weekLabels = ["일", "월", "화", "수", "목", "금", "토"];

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function toDateKey(value: string | Date) {
  if (typeof value === "string") {
    return getCounselingLocalDateKey(value);
  }

  return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: PACEMATE_TIME_ZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: PACEMATE_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));
}

function formatMonthKey(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  return `${year}년 ${month}월`;
}

function formatSelectedDate(dateKey: string) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  return `${date.getUTCMonth() + 1}월 ${date.getUTCDate()}일 ${weekLabels[date.getUTCDay()]}요일`;
}

function buildCalendarDays(slots: CounselingSlot[], monthKey: string) {
  if (!slots.length || !monthKey) {
    return [];
  }

  // The grid renders the requested month; the month list comes from the
  // actual slot range so a booking horizon that straddles a month boundary
  // stays reachable (Stage 4, audit A-3 / KI-004).
  const [year, month] = monthKey.split("-").map(Number);
  const firstOfMonth = new Date(Date.UTC(year, month - 1, 1));
  const calendarStart = new Date(firstOfMonth);
  calendarStart.setUTCDate(firstOfMonth.getUTCDate() - firstOfMonth.getUTCDay());

  const slotsByDate = new Map<string, CounselingSlot[]>();
  for (const slot of slots) {
    const dateKey = toDateKey(slot.start);
    const current = slotsByDate.get(dateKey) ?? [];
    current.push(slot);
    slotsByDate.set(dateKey, current);
  }

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(calendarStart);
    date.setUTCDate(calendarStart.getUTCDate() + index);
    const dateKey = toDateKey(date);

    return {
      date,
      dateKey,
      dayNumber: date.getUTCDate(),
      isCurrentMonth: date.getUTCMonth() === firstOfMonth.getUTCMonth(),
      slots: slotsByDate.get(dateKey) ?? [],
    };
  });
}

export function CounselingWorkspace({
  availableSlots,
  courses,
  professors,
  requests,
}: CounselingWorkspaceProps) {
  const router = useRouter();
  const [mode, setMode] = useState<"course" | "professor">("course");
  const [selectedCourseId, setSelectedCourseId] = useState(courses[0]?.id ?? "");
  const [selectedProfessorId, setSelectedProfessorId] = useState(
    courses[0]?.professors[0]?.id ?? professors[0]?.id ?? "",
  );
  const [professorQuery, setProfessorQuery] = useState("");
  const selectedCourse = courses.find((course) => course.id === selectedCourseId) ?? courses[0] ?? null;
  const courseProfessors = selectedCourse?.professors ?? [];
  const filteredProfessors = professors.filter((professor) => {
    const query = professorQuery.trim().toLowerCase();
    if (!query) {
      return true;
    }

    return [professor.name, professor.departmentName, professor.email]
      .filter(Boolean)
      .some((value) => value?.toLowerCase().includes(query));
  });
  const selectedProfessor =
    [...courseProfessors, ...professors].find((professor) => professor.id === selectedProfessorId) ??
    courseProfessors[0] ??
    professors[0] ??
    null;
  const sortedSlots = useMemo(
    () =>
      availableSlots
        .filter((slot) => !selectedProfessor || slot.professorId === selectedProfessor.id)
        .sort((a, b) => a.start.localeCompare(b.start)),
    [availableSlots, selectedProfessor],
  );
  const monthsWithSlots = useMemo(() => {
    const keys = new Set<string>();
    for (const slot of sortedSlots) {
      keys.add(toDateKey(slot.start).slice(0, 7));
    }
    return [...keys].sort();
  }, [sortedSlots]);
  const firstAvailableDate = sortedSlots[0] ? toDateKey(sortedSlots[0].start) : "";
  const [selectedDate, setSelectedDate] = useState(firstAvailableDate);
  const [viewMonthOverride, setViewMonthOverride] = useState<string | null>(null);
  const viewMonth =
    viewMonthOverride && monthsWithSlots.includes(viewMonthOverride)
      ? viewMonthOverride
      : selectedDate
        ? selectedDate.slice(0, 7)
        : monthsWithSlots[0] ?? "";
  const viewMonthIndex = monthsWithSlots.indexOf(viewMonth);
  const calendarDays = useMemo(
    () => buildCalendarDays(sortedSlots, viewMonth),
    [sortedSlots, viewMonth],
  );
  const [selectedSlotId, setSelectedSlotId] = useState("");
  const [message, setMessage] = useState<{ text: string; ok: boolean; context: "booking" | "requests" } | null>(null);
  const [topic, setTopic] = useState("");
  const [isPending, startTransition] = useTransition();
  const selectedDaySlots = sortedSlots.filter((slot) => toDateKey(slot.start) === selectedDate);
  const selectedSlot = resolveSelectedCounselingSlot(sortedSlots, selectedDate, selectedSlotId);
  const reservedSuggestedStarts = new Set(
    requests
      .filter((request) => request.status === "pending" || request.status === "approved")
      .map((request) => request.requested_start),
  );

  function runAction(
    action: (formData: FormData) => Promise<{ ok: boolean; message: string }>,
    formData: FormData,
    context: "booking" | "requests" = "booking",
  ) {
    setMessage(null);
    startTransition(async () => {
      const result = await action(formData);
      setMessage({ text: result.message, ok: result.ok, context });
      if (result.ok) {
        // A successful booking consumes the slot; refresh so the slot list
        // and the request panel reflect it without navigating away (KI-004).
        setSelectedSlotId("");
        router.refresh();
      }
    });
  }

  function renderMessage(context: "booking" | "requests") {
    if (!message || message.context !== context) {
      return null;
    }

    return (
      <p
        className={`rounded-lg border px-3 py-2 text-sm font-medium ${
          message.ok
            ? "border-emerald-100 bg-emerald-50 text-emerald-700"
            : "border-red-100 bg-red-50 text-red-600"
        }`}
        role={message.ok ? "status" : "alert"}
      >
        {message.text}
      </p>
    );
  }

  function selectDate(dateKey: string) {
    setSelectedDate(dateKey);
    setSelectedSlotId("");
    setViewMonthOverride(null);
  }

  function chooseCourse(courseId: string) {
    setMode("course");
    setSelectedCourseId(courseId);
    const course = courses.find((item) => item.id === courseId);
    const professor = course?.professors[0];
    setViewMonthOverride(null);
    if (professor) {
      setSelectedProfessorId(professor.id);
      const firstSlot = availableSlots.find((slot) => slot.professorId === professor.id);
      setSelectedDate(firstSlot ? toDateKey(firstSlot.start) : "");
      setSelectedSlotId("");
    } else {
      setSelectedDate("");
      setSelectedSlotId("");
    }
  }

  function chooseProfessor(professorId: string) {
    setSelectedProfessorId(professorId);
    const firstSlot = availableSlots.find((slot) => slot.professorId === professorId);
    setSelectedDate(firstSlot ? toDateKey(firstSlot.start) : "");
    setSelectedSlotId("");
    setViewMonthOverride(null);
  }

  function requestSelectedSlot() {
    if (!selectedSlot) {
      setMessage({ text: "상담 시간을 먼저 선택해 주세요.", ok: false, context: "booking" });
      return;
    }

    const formData = new FormData();
    formData.set("slotId", getCounselingSlotId(selectedSlot));
    formData.set("topic", topic.trim() || "학업 상담");
    runAction(createCounselingRequest, formData);
  }

  function reserveSuggestion(request: StudentCounselingRequest) {
    const formData = new FormData();
    formData.set("requestId", request.id);
    runAction(reserveSuggestedCounseling, formData, "requests");
  }

  function cancelRequest(request: StudentCounselingRequest) {
    if (!window.confirm(`${formatDateTime(request.requested_start)} 상담 신청을 취소할까요?`)) {
      return;
    }

    const formData = new FormData();
    formData.set("requestId", request.id);
    runAction(cancelMyCounselingRequest, formData, "requests");
  }

  return (
    <section className="section counseling-workspace">
      <section className="professor-panel counseling-booking-panel">
        <div className="community-section-heading">
          <h2>상담 예약</h2>
          <CalendarCheck size={18} aria-hidden="true" />
        </div>

        <div className="counseling-mode-tabs" role="tablist" aria-label="상담 예약 방식">
          <button
            aria-selected={mode === "course"}
            data-active={mode === "course"}
            onClick={() => setMode("course")}
            role="tab"
            type="button"
          >
            <BookOpen size={16} aria-hidden="true" />
            과목별 예약
          </button>
          <button
            aria-selected={mode === "professor"}
            data-active={mode === "professor"}
            onClick={() => setMode("professor")}
            role="tab"
            type="button"
          >
            <Search size={16} aria-hidden="true" />
            교수별 검색
          </button>
        </div>

        <div className="counseling-target-layout">
          {mode === "course" ? (
            <div className="counseling-target-panel">
              <div className="counseling-target-heading">
                <span>1단계</span>
                <strong>수강 과목 선택</strong>
              </div>
              {courses.length ? (
                <div className="counseling-course-list">
                  {courses.map((course) => (
                    <button
                      data-selected={selectedCourse?.id === course.id}
                      key={course.id}
                      onClick={() => chooseCourse(course.id)}
                      type="button"
                    >
                      <span>{course.code}</span>
                      <strong>{course.name}</strong>
                      <small>{course.professors.length}명 담당</small>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="community-empty">
                  <p>아직 시간표에 등록된 과목이 없습니다. 마이페이지에서 과목을 먼저 추가해 주세요.</p>
                </div>
              )}
            </div>
          ) : (
            <div className="counseling-target-panel">
              <div className="counseling-target-heading">
                <span>1단계</span>
                <strong>교수 검색</strong>
              </div>
              <label className="community-search">
                <Search size={17} aria-hidden="true" />
                <input
                  aria-label="교수 검색"
                  value={professorQuery}
                  onChange={(event) => setProfessorQuery(event.target.value)}
                  placeholder="교수 이름, 학부, 이메일 검색"
                />
              </label>
              <div className="counseling-professor-list">
                {filteredProfessors.map((professor) => (
                  <button
                    data-selected={selectedProfessor?.id === professor.id}
                    key={professor.id}
                    onClick={() => chooseProfessor(professor.id)}
                    type="button"
                  >
                    <UserRound size={18} aria-hidden="true" />
                    <span>
                      <strong>{professor.name}</strong>
                      <small>{professor.departmentName ?? "소속 정보 없음"}</small>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="counseling-professor-card">
            <div className="counseling-target-heading">
              <span>2단계</span>
              <strong>상담 대상 확인</strong>
            </div>
            {mode === "course" && courseProfessors.length > 1 ? (
              <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="담당 교수 선택">
                {courseProfessors.map((professor) => (
                  <button
                    aria-pressed={selectedProfessor?.id === professor.id}
                    className={`rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors ${
                      selectedProfessor?.id === professor.id
                        ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                        : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                    }`}
                    key={professor.id}
                    onClick={() => chooseProfessor(professor.id)}
                    type="button"
                  >
                    {professor.name} 교수
                  </button>
                ))}
              </div>
            ) : null}
            {selectedProfessor ? (
              <article>
                <span className="icon-box">
                  <UserRound aria-hidden="true" />
                </span>
                <div>
                  <h3>{selectedProfessor.name} 교수</h3>
                  <p>{selectedProfessor.departmentName ?? selectedCourse?.category ?? "담당 교수"}</p>
                  <small>{selectedProfessor.office ?? "연구실 정보 미등록"}</small>
                  <small>{selectedProfessor.email ?? "이메일 정보 미등록"}</small>
                </div>
              </article>
            ) : (
              <div className="community-empty">
                <p>먼저 상담할 교수님을 선택해 주세요.</p>
              </div>
            )}
          </div>
        </div>

        {selectedProfessor && calendarDays.length ? (
          <div className="counseling-booking-layout">
            <div className="counseling-calendar" aria-label={`${selectedProfessor.name} 교수 상담 가능 날짜`}>
              <div className="counseling-calendar-heading">
                <div className="flex items-center gap-1.5">
                  <button
                    aria-label="이전 달"
                    className="rounded-lg border border-gray-200 p-1.5 text-gray-600 transition-colors hover:bg-gray-50 disabled:cursor-default disabled:opacity-35"
                    disabled={viewMonthIndex <= 0}
                    onClick={() => setViewMonthOverride(monthsWithSlots[viewMonthIndex - 1])}
                    type="button"
                  >
                    <ChevronLeft size={16} aria-hidden="true" />
                  </button>
                  <strong>{formatMonthKey(viewMonth)}</strong>
                  <button
                    aria-label="다음 달"
                    className="rounded-lg border border-gray-200 p-1.5 text-gray-600 transition-colors hover:bg-gray-50 disabled:cursor-default disabled:opacity-35"
                    disabled={viewMonthIndex < 0 || viewMonthIndex >= monthsWithSlots.length - 1}
                    onClick={() => setViewMonthOverride(monthsWithSlots[viewMonthIndex + 1])}
                    type="button"
                  >
                    <ChevronRight size={16} aria-hidden="true" />
                  </button>
                </div>
                <span>{selectedProfessor.name} 교수님의 가능한 날짜만 선택할 수 있어요</span>
              </div>
              <div className="counseling-weekdays">
                {weekLabels.map((day) => (
                  <span key={day}>{day}</span>
                ))}
              </div>
              <div className="counseling-calendar-grid">
                {calendarDays.map((day) => {
                  const hasSlots = day.slots.length > 0;
                  const isSelected = day.dateKey === selectedDate;

                  const [, labelMonth] = day.dateKey.split("-").map(Number);

                  return (
                    <button
                      aria-label={`${labelMonth}월 ${day.dayNumber}일${hasSlots ? `, 예약 가능 ${day.slots.length}개` : ", 예약 불가"}`}
                      aria-pressed={isSelected}
                      className="counseling-date-button"
                      data-current-month={day.isCurrentMonth}
                      data-selected={isSelected}
                      disabled={!hasSlots}
                      key={day.dateKey}
                      onClick={() => selectDate(day.dateKey)}
                      type="button"
                    >
                      <span aria-hidden="true">{day.dayNumber}</span>
                      {hasSlots ? <small aria-hidden="true">{day.slots.length}개</small> : null}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="counseling-time-panel">
              <div className="counseling-time-heading">
                <span>선택 날짜</span>
                <strong>{selectedDate ? formatSelectedDate(selectedDate) : "날짜 선택"}</strong>
              </div>
              <div className="counseling-time-list" aria-label="상담 가능 시간">
                {selectedDaySlots.map((slot) => {
                  const slotId = getCounselingSlotId(slot);
                  const isSelected = selectedSlot ? getCounselingSlotId(selectedSlot) === slotId : false;

                  return (
                    <button
                      aria-pressed={isSelected}
                      className="counseling-time-button"
                      data-selected={isSelected}
                      key={slotId}
                      onClick={() => setSelectedSlotId(getCounselingSlotId(slot))}
                      type="button"
                    >
                      <strong>
                        {formatTime(slot.start)} - {formatTime(slot.end)}
                      </strong>
                      <span>{slot.professorName} 교수</span>
                    </button>
                  );
                })}
              </div>
              <label className="field">
                <span>상담 내용</span>
                <input
                  value={topic}
                  onChange={(event) => setTopic(event.target.value)}
                  placeholder="예: 수강 순서 상담"
                />
              </label>
              <button
                className="button button-default button-md"
                disabled={isPending || !selectedSlot}
                onClick={requestSelectedSlot}
                type="button"
              >
                {isPending ? "신청 중…" : "선택한 시간으로 신청"}
                <Send size={16} aria-hidden="true" />
              </button>
              {!selectedSlot && (!message || message.context !== "booking") ? (
                <p className="text-xs text-gray-400">시간을 선택하면 신청 버튼이 활성화됩니다.</p>
              ) : null}
              {renderMessage("booking")}
            </div>
          </div>
        ) : (
          <div className="community-empty">
            <p>
              {selectedProfessor
                ? "선택한 교수님의 바로 신청 가능한 상담 시간이 없습니다."
                : "상담할 교수님을 먼저 선택해 주세요."}
            </p>
          </div>
        )}
      </section>

      <section className="professor-panel">
        <div className="community-section-heading">
          <h2>내 상담 요청</h2>
          <span>{requests.length}건</span>
        </div>
        {renderMessage("requests")}
        {requests.length ? (
          <div className="professor-request-list">
            {requests.map((request) => (
              <article key={request.id}>
                <div>
                  <strong>{request.topic}</strong>
                  <p>
                    {request.professor?.name ?? "교수"} · {formatDateTime(request.requested_start)}
                  </p>
                </div>
                <span>{statusLabels[request.status]}</span>
                {request.professor_note ? <p>{request.professor_note}</p> : null}
                {request.status === "pending" || request.status === "approved" ? (
                  <button
                    className="button button-outline button-sm"
                    disabled={isPending}
                    onClick={() => cancelRequest(request)}
                    type="button"
                  >
                    상담 신청 취소
                  </button>
                ) : null}
                {request.status === "rejected" && request.suggested_start ? (
                  <div className="counseling-suggestion">
                    <p>추천 시간: {formatDateTime(request.suggested_start)}</p>
                    {reservedSuggestedStarts.has(request.suggested_start) ? (
                      <strong>추천 시간 재신청 완료</strong>
                    ) : (
                      <button
                        className="button button-default button-md"
                        disabled={isPending}
                        onClick={() => reserveSuggestion(request)}
                        type="button"
                      >
                        추천 시간으로 바로 예약
                        <CalendarCheck size={16} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <div className="community-empty">
            <p>아직 신청한 상담이 없습니다.</p>
          </div>
        )}
      </section>

    </section>
  );
}
