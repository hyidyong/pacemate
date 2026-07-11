import type { AcademicEvent } from "@/types/academic-calendar";

/**
 * Transcribed from docs/reference/haksa_schedule_2026.pdf.
 * The source document is titled "2026학년도 학사일정(안)", so every event remains draft.
 */
export const academicCalendar2026 = [
  { id: "first-semester-start-2026-03-01", title: "1학기 개시일: 1", startDate: "2026-03-01", endDate: "2026-03-01", category: "semester", audience: "all", semester: 1, isOfficial: true, sourceStatus: "draft" },
  { id: "substitute-holiday-march-first-movement-day-2026-03-02", title: "대체공휴일(3·1절): 2", startDate: "2026-03-02", endDate: "2026-03-02", category: "holiday", audience: "all", semester: 1, isOfficial: true, sourceStatus: "draft" },
  { id: "first-semester-class-begins-2026-03-03", title: "1학기 개강: 3", startDate: "2026-03-03", endDate: "2026-03-03", category: "class", audience: "all", semester: 1, isOfficial: true, sourceStatus: "draft" },
  { id: "first-semester-course-correction-2026-03-03", title: "수강정정: 3 ~ 5", startDate: "2026-03-03", endDate: "2026-03-05", category: "registration", audience: "student", semester: 1, isOfficial: true, sourceStatus: "draft" },
  { id: "first-semester-quarter-point-2026-03-30", title: "1학기 수업일수 ¼선: 30 (27일차: 29일, 일요일)", startDate: "2026-03-30", endDate: "2026-03-30", category: "class", audience: "all", semester: 1, isOfficial: true, sourceStatus: "draft" },
  { id: "holy-week-2026-03-30", title: "고난 주간: 3. 30. ~ 4. 4.", startDate: "2026-03-30", endDate: "2026-04-04", category: "religious", audience: "all", semester: 1, isOfficial: true, sourceStatus: "draft" },

  { id: "first-semester-one-third-point-2026-04-06", title: "1학기 수업일수 ⅓선: 6(35일차)", startDate: "2026-04-06", endDate: "2026-04-06", category: "class", audience: "all", semester: 1, isOfficial: true, sourceStatus: "draft" },
  { id: "easter-2026-04-05", title: "부활절: 5", startDate: "2026-04-05", endDate: "2026-04-05", category: "religious", audience: "all", semester: 1, isOfficial: true, sourceStatus: "draft" },
  { id: "easter-service-2026-04-09", title: "부활절 예배: 9", startDate: "2026-04-09", endDate: "2026-04-09", category: "religious", audience: "all", semester: 1, isOfficial: true, sourceStatus: "draft" },
  { id: "first-semester-half-point-2026-04-24", title: "1학기 수업일수 ½선: 24(53일차)", startDate: "2026-04-24", endDate: "2026-04-24", category: "class", audience: "all", semester: 1, isOfficial: true, sourceStatus: "draft" },

  { id: "labor-day-holiday-2026-05-01", title: "노동절(공휴일): 1", startDate: "2026-05-01", endDate: "2026-05-01", category: "holiday", audience: "all", semester: 1, isOfficial: true, sourceStatus: "draft" },
  // 대상이 문서상 명시되지 않아 all로 분류.
  { id: "teaching-practicum-2026-05-04", title: "교육 실습: 4 ~ 29", startDate: "2026-05-04", endDate: "2026-05-29", category: "class", audience: "all", semester: 1, isOfficial: true, sourceStatus: "draft" },
  { id: "childrens-day-holiday-2026-05-05", title: "어린이날(공휴일): 5", startDate: "2026-05-05", endDate: "2026-05-05", category: "holiday", audience: "all", semester: 1, isOfficial: true, sourceStatus: "draft" },
  { id: "first-semester-two-thirds-point-2026-05-11", title: "1학기 수업일수 ⅔선: 11(70일차)", startDate: "2026-05-11", endDate: "2026-05-11", category: "class", audience: "all", semester: 1, isOfficial: true, sourceStatus: "draft" },
  { id: "foundation-anniversary-closure-2026-05-20", title: "창립기념일(휴업일): 20", startDate: "2026-05-20", endDate: "2026-05-20", category: "holiday", audience: "all", semester: 1, isOfficial: true, sourceStatus: "draft" },
  { id: "substitute-holiday-buddhas-birthday-2026-05-25", title: "대체공휴일(부처님오신날): 25", startDate: "2026-05-25", endDate: "2026-05-25", category: "holiday", audience: "all", semester: 1, isOfficial: true, sourceStatus: "draft" },

  { id: "local-election-2026-06-03", title: "2026 지방선거: 3", startDate: "2026-06-03", endDate: "2026-06-03", category: "holiday", audience: "all", semester: 1, isOfficial: true, sourceStatus: "draft" },
  { id: "labor-day-makeup-class-2026-06-09", title: "노동절[5. 1.] 휴강에 대한 보강일: 9", startDate: "2026-06-09", endDate: "2026-06-09", category: "class", audience: "all", semester: 1, isOfficial: true, sourceStatus: "draft" },
  { id: "childrens-day-makeup-class-2026-06-10", title: "어린이날[5. 5.] 휴강에 대한 보강일: 10", startDate: "2026-06-10", endDate: "2026-06-10", category: "class", audience: "all", semester: 1, isOfficial: true, sourceStatus: "draft" },
  { id: "foundation-anniversary-makeup-class-2026-06-11", title: "창립기념일(휴업일)[5. 20.] 휴강에 대한 보강일: 11", startDate: "2026-06-11", endDate: "2026-06-11", category: "class", audience: "all", semester: 1, isOfficial: true, sourceStatus: "draft" },
  { id: "buddhas-birthday-makeup-class-2026-06-12", title: "대체공휴일(부처님오신날)[5. 25.] 휴강에 대한 보강일: 12", startDate: "2026-06-12", endDate: "2026-06-12", category: "class", audience: "all", semester: 1, isOfficial: true, sourceStatus: "draft" },
  { id: "local-election-makeup-class-2026-06-15", title: "2026 지방선거[6. 3.] 휴강에 대한 보강일: 15", startDate: "2026-06-15", endDate: "2026-06-15", category: "class", audience: "all", semester: 1, isOfficial: true, sourceStatus: "draft" },
  { id: "first-semester-final-exam-2026-06-16", title: "1학기 정기시험: 16 ~ 22", startDate: "2026-06-16", endDate: "2026-06-22", category: "exam", audience: "all", semester: 1, isOfficial: true, sourceStatus: "draft" },
  { id: "summer-break-and-seasonal-semester-start-2026-06-23", title: "하계방학 및 계절학기 시작: 23", startDate: "2026-06-23", endDate: "2026-06-23", category: "semester", audience: "all", semester: 1, isOfficial: true, sourceStatus: "draft" },

  { id: "second-semester-readmission-first-round-2026-07-01", title: "2학기 재입학 신청(1차): 1 ~ 7", startDate: "2026-07-01", endDate: "2026-07-07", category: "registration", audience: "student", semester: 2, isOfficial: true, sourceStatus: "draft" },
  { id: "second-semester-reinstatement-first-round-2026-07-01", title: "2학기 복학 신청(1차): 1 ~ 15", startDate: "2026-07-01", endDate: "2026-07-15", category: "registration", audience: "student", semester: 2, isOfficial: true, sourceStatus: "draft" },
  { id: "constitution-day-holiday-2026-07-17", title: "제헌절(공휴일): 17", startDate: "2026-07-17", endDate: "2026-07-17", category: "holiday", audience: "all", semester: 1, isOfficial: true, sourceStatus: "draft" },

  { id: "second-semester-course-registration-2026-08-03", title: "2학기 수강신청: 3 ~ 6", startDate: "2026-08-03", endDate: "2026-08-06", category: "registration", audience: "student", semester: 2, isOfficial: true, sourceStatus: "draft" },
  { id: "substitute-holiday-liberation-day-2026-08-17", title: "대체공휴일(광복절): 17", startDate: "2026-08-17", endDate: "2026-08-17", category: "holiday", audience: "all", semester: 1, isOfficial: true, sourceStatus: "draft" },
  // 대상이 문서상 명시되지 않아 all로 분류.
  { id: "undergraduate-degree-award-second-half-2026-08-20", title: "2025학년도 후기 학부 학위수여일: 20", startDate: "2026-08-20", endDate: "2026-08-20", category: "graduation", audience: "all", semester: 1, isOfficial: true, sourceStatus: "draft" },
  // 대상이 문서상 명시되지 않아 all로 분류.
  { id: "graduate-degree-award-second-half-2026-08-20", title: "2025학년도 후기 대학원 학위수여일: 20", startDate: "2026-08-20", endDate: "2026-08-20", category: "graduation", audience: "all", semester: 1, isOfficial: true, sourceStatus: "draft" },
  { id: "second-semester-tuition-payment-2026-08-24", title: "2학기 등록금 수납: 24 ~ 27", startDate: "2026-08-24", endDate: "2026-08-27", category: "registration", audience: "student", semester: 2, isOfficial: true, sourceStatus: "draft" },
  { id: "second-semester-opening-service-2026-08-26", title: "2학기 개강 예배: 26", startDate: "2026-08-26", endDate: "2026-08-26", category: "religious", audience: "all", semester: 2, isOfficial: true, sourceStatus: "draft" },

  { id: "second-semester-start-and-class-begins-2026-09-01", title: "2학기 개시일(개강일): 1", startDate: "2026-09-01", endDate: "2026-09-01", category: "semester", audience: "all", semester: 2, isOfficial: true, sourceStatus: "draft" },
  { id: "second-semester-quarter-point-2026-09-28", title: "2학기 수업일수 ¼선: 28 (27일차: 27일, 일요일)", startDate: "2026-09-28", endDate: "2026-09-28", category: "class", audience: "all", semester: 2, isOfficial: true, sourceStatus: "draft" },
  { id: "chuseok-holiday-2026-09-24", title: "추석(연휴): 24 ~ 26(휴강일: 24 ~ 25)", startDate: "2026-09-24", endDate: "2026-09-26", category: "holiday", audience: "all", semester: 2, isOfficial: true, sourceStatus: "draft" },

  { id: "substitute-holiday-national-foundation-day-2026-10-05", title: "대체공휴일(개천절): 5", startDate: "2026-10-05", endDate: "2026-10-05", category: "holiday", audience: "all", semester: 2, isOfficial: true, sourceStatus: "draft" },
  { id: "second-semester-one-third-point-2026-10-06", title: "2학기 수업일수 ⅓선: 6 (35일차: 5일, 공휴일)", startDate: "2026-10-06", endDate: "2026-10-06", category: "class", audience: "all", semester: 2, isOfficial: true, sourceStatus: "draft" },
  { id: "hangul-day-holiday-2026-10-09", title: "한글날(공휴일): 9", startDate: "2026-10-09", endDate: "2026-10-09", category: "holiday", audience: "all", semester: 2, isOfficial: true, sourceStatus: "draft" },
  { id: "second-semester-half-point-2026-10-23", title: "2학기 수업일수 ½선: 23 (53일차)", startDate: "2026-10-23", endDate: "2026-10-23", category: "class", audience: "all", semester: 2, isOfficial: true, sourceStatus: "draft" },

  { id: "second-semester-two-thirds-point-2026-11-09", title: "2학기 수업일수 ⅔선: 9 (70일차)", startDate: "2026-11-09", endDate: "2026-11-09", category: "class", audience: "all", semester: 2, isOfficial: true, sourceStatus: "draft" },
  { id: "thanksgiving-service-2026-11-19", title: "추수감사 예배: 19", startDate: "2026-11-19", endDate: "2026-11-19", category: "religious", audience: "all", semester: 2, isOfficial: true, sourceStatus: "draft" },

  { id: "chuseok-september-24-makeup-class-2026-12-08", title: "추석 휴일[9. 24.] 휴강에 대한 보강일: 8", startDate: "2026-12-08", endDate: "2026-12-08", category: "class", audience: "all", semester: 2, isOfficial: true, sourceStatus: "draft" },
  { id: "chuseok-september-25-makeup-class-2026-12-09", title: "추석 휴일[9. 25.] 휴강에 대한 보강일: 9", startDate: "2026-12-09", endDate: "2026-12-09", category: "class", audience: "all", semester: 2, isOfficial: true, sourceStatus: "draft" },
  { id: "national-foundation-day-makeup-class-2026-12-10", title: "개천절 대체공휴일[10. 5.]휴강에 대한 보강일: 10", startDate: "2026-12-10", endDate: "2026-12-10", category: "class", audience: "all", semester: 2, isOfficial: true, sourceStatus: "draft" },
  { id: "hangul-day-makeup-class-2026-12-11", title: "한글날[10. 9.] 휴강에 대한 보강일: 11", startDate: "2026-12-11", endDate: "2026-12-11", category: "class", audience: "all", semester: 2, isOfficial: true, sourceStatus: "draft" },
  { id: "christmas-celebration-service-2026-12-11", title: "성탄 축하 예배: 11", startDate: "2026-12-11", endDate: "2026-12-11", category: "religious", audience: "all", semester: 2, isOfficial: true, sourceStatus: "draft" },
  { id: "second-semester-final-exam-2026-12-14", title: "2학기 정기시험: 14 ~ 18", startDate: "2026-12-14", endDate: "2026-12-18", category: "exam", audience: "all", semester: 2, isOfficial: true, sourceStatus: "draft" },
  { id: "winter-break-and-seasonal-semester-start-2026-12-21", title: "동계방학 및 계절학기 시작: 21", startDate: "2026-12-21", endDate: "2026-12-21", category: "semester", audience: "all", semester: 2, isOfficial: true, sourceStatus: "draft" },
  { id: "christmas-holiday-2026-12-25", title: "성탄절(공휴일): 25", startDate: "2026-12-25", endDate: "2026-12-25", category: "holiday", audience: "all", semester: 2, isOfficial: true, sourceStatus: "draft" },

  { id: "new-years-day-2027-01-01", title: "신정: 1", startDate: "2027-01-01", endDate: "2027-01-01", category: "holiday", audience: "all", semester: 2, isOfficial: true, sourceStatus: "draft" },
  { id: "first-semester-readmission-first-round-2027-01-04", title: "2027학년도 1학기 재입학 신청(1차): 4 ~ 8", startDate: "2027-01-04", endDate: "2027-01-08", category: "registration", audience: "student", semester: 1, isOfficial: true, sourceStatus: "draft" },
  { id: "first-semester-reinstatement-first-round-2027-01-04", title: "2027학년도 1학기 복학 신청(1차): 4 ~ 15", startDate: "2027-01-04", endDate: "2027-01-15", category: "registration", audience: "student", semester: 1, isOfficial: true, sourceStatus: "draft" },

  { id: "first-semester-course-registration-2027-02-01", title: "2027학년도 1학기 수강신청: 1 ~ 4", startDate: "2027-02-01", endDate: "2027-02-04", category: "registration", audience: "student", semester: 1, isOfficial: true, sourceStatus: "draft" },
  // 대상이 문서상 명시되지 않아 all로 분류.
  { id: "undergraduate-degree-award-first-half-2027-02-18", title: "2026학년도 전기 학부 학위수여식: 18", startDate: "2027-02-18", endDate: "2027-02-18", category: "graduation", audience: "all", semester: 2, isOfficial: true, sourceStatus: "draft" },
  // 대상이 문서상 명시되지 않아 all로 분류.
  { id: "graduate-degree-award-first-half-2027-02-19", title: "2026학년도 전기 대학원 학위수여식: 19", startDate: "2027-02-19", endDate: "2027-02-19", category: "graduation", audience: "all", semester: 2, isOfficial: true, sourceStatus: "draft" },
  { id: "first-semester-tuition-payment-2027-02-22", title: "2027학년도 1학기 등록금 수납: 22 ~ 25", startDate: "2027-02-22", endDate: "2027-02-25", category: "registration", audience: "student", semester: 1, isOfficial: true, sourceStatus: "draft" },
  { id: "all-faculty-meeting-2027-02-23", title: "전체 교수회: 23", startDate: "2027-02-23", endDate: "2027-02-23", category: "administration", audience: "professor", semester: 2, isOfficial: true, sourceStatus: "draft" },
  { id: "first-semester-opening-service-2027-02-24", title: "2027학년도 1학기 개강 예배: 24", startDate: "2027-02-24", endDate: "2027-02-24", category: "religious", audience: "all", semester: 1, isOfficial: true, sourceStatus: "draft" },
  { id: "first-semester-entrance-ceremony-2027-02-26", title: "2027학년도 입학식: 26", startDate: "2027-02-26", endDate: "2027-02-26", category: "administration", audience: "all", semester: 1, isOfficial: true, sourceStatus: "draft" },
] as const satisfies readonly AcademicEvent[];
