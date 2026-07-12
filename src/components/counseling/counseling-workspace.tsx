"use client";

import { useMemo, useState, useTransition } from "react";
import { BookOpen, CalendarCheck, Search, Send, UserRound } from "lucide-react";
import {
  createCounselingRequest,
  reserveSuggestedCounseling,
} from "@/services/counseling.actions";
import type {
  CounselingSlot,
  CounselingCourseOption,
  CounselingProfessor,
  StudentCounselingRequest,
} from "@/services/counseling.service";
import { getCounselingSlotId } from "@/services/counseling.service";

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
  const date = typeof value === "string" ? new Date(value) : value;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatDateTime(value: string) {
  const date = new Date(value);
  return `${date.getFullYear()}. ${date.getMonth() + 1}. ${date.getDate()}. ${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}`;
}

function formatTime(value: string) {
  const date = new Date(value);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatMonth(date: Date) {
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월`;
}

function formatSelectedDate(dateKey: string) {
  const date = new Date(`${dateKey}T00:00:00`);
  return `${date.getMonth() + 1}월 ${date.getDate()}일 ${weekLabels[date.getDay()]}요일`;
}

function buildCalendarDays(slots: CounselingSlot[]) {
  if (!slots.length) {
    return [];
  }

  const firstSlotDate = new Date(slots[0].start);
  const firstOfMonth = new Date(firstSlotDate.getFullYear(), firstSlotDate.getMonth(), 1);
  const calendarStart = new Date(firstOfMonth);
  calendarStart.setDate(firstOfMonth.getDate() - firstOfMonth.getDay());

  const slotsByDate = new Map<string, CounselingSlot[]>();
  for (const slot of slots) {
    const dateKey = toDateKey(slot.start);
    const current = slotsByDate.get(dateKey) ?? [];
    current.push(slot);
    slotsByDate.set(dateKey, current);
  }

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(calendarStart);
    date.setDate(calendarStart.getDate() + index);
    const dateKey = toDateKey(date);

    return {
      date,
      dateKey,
      dayNumber: date.getDate(),
      isCurrentMonth: date.getMonth() === firstSlotDate.getMonth(),
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
  const calendarDays = useMemo(() => buildCalendarDays(sortedSlots), [sortedSlots]);
  const firstAvailableDate = sortedSlots[0] ? toDateKey(sortedSlots[0].start) : "";
  const [selectedDate, setSelectedDate] = useState(firstAvailableDate);
  const [selectedSlotId, setSelectedSlotId] = useState("");
  const [message, setMessage] = useState("");
  const [topic, setTopic] = useState("");
  const [isPending, startTransition] = useTransition();
  const selectedDaySlots = sortedSlots.filter((slot) => toDateKey(slot.start) === selectedDate);
  const selectedSlot =
    sortedSlots.find((slot) => getCounselingSlotId(slot) === selectedSlotId) ??
    selectedDaySlots[0] ??
    null;
  const calendarMonth = calendarDays[14]?.date ?? new Date();
  const reservedSuggestedStarts = new Set(
    requests
      .filter((request) => request.status === "pending" || request.status === "approved")
      .map((request) => request.requested_start),
  );

  function runAction(action: (formData: FormData) => Promise<{ message: string }>, formData: FormData) {
    setMessage("");
    startTransition(async () => {
      const result = await action(formData);
      setMessage(result.message);
    });
  }

  function selectDate(dateKey: string) {
    setSelectedDate(dateKey);
    const firstSlot = sortedSlots.find((slot) => toDateKey(slot.start) === dateKey);
    setSelectedSlotId(firstSlot ? getCounselingSlotId(firstSlot) : "");
  }

  function chooseCourse(courseId: string) {
    setMode("course");
    setSelectedCourseId(courseId);
    const course = courses.find((item) => item.id === courseId);
    const professor = course?.professors[0];
    if (professor) {
      setSelectedProfessorId(professor.id);
      const firstSlot = availableSlots.find((slot) => slot.professorId === professor.id);
      setSelectedDate(firstSlot ? toDateKey(firstSlot.start) : "");
      setSelectedSlotId(firstSlot ? getCounselingSlotId(firstSlot) : "");
    } else {
      setSelectedDate("");
      setSelectedSlotId("");
    }
  }

  function chooseProfessor(professorId: string) {
    setSelectedProfessorId(professorId);
    const firstSlot = availableSlots.find((slot) => slot.professorId === professorId);
    setSelectedDate(firstSlot ? toDateKey(firstSlot.start) : "");
    setSelectedSlotId(firstSlot ? getCounselingSlotId(firstSlot) : "");
  }

  function requestSelectedSlot() {
    if (!selectedSlot) {
      setMessage("상담 시간을 먼저 선택해 주세요.");
      return;
    }

    const formData = new FormData();
    formData.set("professorId", selectedSlot.professorId);
    formData.set("requestedStart", selectedSlot.start);
    formData.set("requestedEnd", selectedSlot.end);
    formData.set("topic", topic.trim() || "학업 상담");
    runAction(createCounselingRequest, formData);
  }

  function reserveSuggestion(request: StudentCounselingRequest) {
    const formData = new FormData();
    formData.set("requestId", request.id);
    runAction(reserveSuggestedCounseling, formData);
  }

  return (
    <section className="section counseling-workspace">
      <section className="professor-panel counseling-booking-panel">
        <div className="community-section-heading">
          <h2>상담 예약</h2>
          <CalendarCheck size={18} aria-hidden="true" />
        </div>

        <div className="counseling-mode-tabs" role="tablist" aria-label="상담 예약 방식">
          <button data-active={mode === "course"} onClick={() => setMode("course")} type="button">
            <BookOpen size={16} aria-hidden="true" />
            과목별 예약
          </button>
          <button data-active={mode === "professor"} onClick={() => setMode("professor")} type="button">
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
                <strong>{formatMonth(calendarMonth)}</strong>
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

                  return (
                    <button
                      aria-pressed={isSelected}
                      className="counseling-date-button"
                      data-current-month={day.isCurrentMonth}
                      data-selected={isSelected}
                      disabled={!hasSlots}
                      key={day.dateKey}
                      onClick={() => selectDate(day.dateKey)}
                      type="button"
                    >
                      <span>{day.dayNumber}</span>
                      {hasSlots ? <small>{day.slots.length}개</small> : null}
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
                선택한 시간으로 신청
                <Send size={16} aria-hidden="true" />
              </button>
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

      {message ? <p className="mypage-message">{message}</p> : null}
    </section>
  );
}
