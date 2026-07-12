# 주간 로드맵 생성 준비 상태

## 범위와 확인 기준

이 문서는 1-C-2A의 read-only 점검 결과와 1-C-2B 구현 경계를 기록한다. 대상은 Supabase `pacemate` 프로젝트(`szztsqdnvenfbgxtylkl`)의 2026-2 학기와 두 개의 법학과 offering이다. 이번 단계에서는 DB, migration, seed, 애플리케이션 코드, UI를 변경하지 않았다.

## 현재 실제 DB 상태

### 학기와 offering

| 항목 | 값 |
| --- | --- |
| term | `783bfca3-3dae-400c-b6e8-08683c4ba3db` / `2026-2` |
| term 일정 | 2026-09-01 ~ 2026-12-20, `Asia/Seoul`, 15주, `is_active=false` |
| 회사법 offering | `d0761612-d2db-413a-a800-1d554a6876eb`, 김재두, 2026-2 |
| 행정절차와행정구제 offering | `228bb6cc-497c-4065-bf83-c9b0d906812c`, 김영수, 2026-2 |

두 offering 모두 `section_label`, `starts_on`, `ends_on` override가 null이다. 각 과목은 `course_professors.semester_label=2026-2`와 2026-2 teaching slot 2건으로 확인된다.

### syllabus와 주차 데이터

| offering | syllabus | 본문 상태 | `course_weekly_plans` |
| --- | --- | --- | ---: |
| 회사법 | `회사법 강의계획서.pdf` | parsed text 181자. 회사 개념·종류·설립·주주·주주총회·이사/이사회·재무질서·유한회사·합병/분할·기말고사 주제 목록 | 0 |
| 행정절차와행정구제 | `행정절차와행정구제 강의계획서.pdf` | parsed text 174자. 행정절차법·정보공개/개인정보·행정상 강제집행·행정벌·행정심판·행정소송·국가배상/손실보상·종합정리/기말고사 주제 목록 | 0 |

syllabi는 `course_id`와 `source_name`, `parsed_text`를 보유하지만 `professor_id`, `term_id`, `semester_label`을 보유하지 않는다. 현재 각 course에 2026-2 offering이 하나씩만 있으므로 course_id 기준 후보는 식별할 수 있지만, 이것만으로 주차·교수·학기 정보를 syllabus에 추정해 기록하지 않는다.

두 parsed text 모두 1~15주별 번호, 학습목표, 중간·기말 평가 주차가 구조화되어 있지 않다. 따라서 현재는 `course_weekly_plans`를 생성할 근거가 없다.

### 학생과 progress

- `student_profiles`: 11건, onboarded 0건
- `student_courses`: 6건, `offering_id` 연결 0건
- 회사법 course_id를 가진 `student_courses`: 0건
- `student_course_progress`: 0건
- `student_weekly_progress`: 0건

학생 이름·이메일·학번·학생 UUID는 이 문서에 기록하지 않는다. 실제 offering과 일치하는 학생 연결이 없으므로 학생별 주간 로드맵 생성 대상은 현재 0명이다. 관심 과목 row를 수강 완료·수강 중으로 해석하거나 새 student_courses row를 만드는 것은 금지한다.

## 현재 로컬 서비스 상태

`src/services/weekly-roadmap.server.ts`는 다음 방식으로 동작한다.

- `getActiveAcademicTermForSession()`은 student session을 요구하고 `is_active=true` term만 조회한다. 현재 term이 false이므로 결과는 null이다.
- `getStudentCourseOfferingsForSession()`은 session 학생의 `student_courses.offering_id is not null`만 조회한다. 현재 결과는 빈 배열이다.
- `getCourseWeeklyPlanForSession()`과 `getStudentWeeklyProgressForSession()`은 먼저 해당 offering이 학생에게 배정되었는지 검증한다. 현재는 배정 row가 없어 접근할 수 없다.
- syllabus fallback, parsed text 주차 추출, course_weekly_plans 자동 생성 로직은 없다.
- 모든 조회는 signed demo session과 server-only service-role client를 사용하며 브라우저에 service-role key를 노출하지 않는다.

## 현재 생성 가능한 로드맵 유형

### 실제 학생용 주간 로드맵

생성 불가. 비활성 term, 학생 offering 연결 0건, progress 0건, weekly plan 0건이 동시에 존재한다. 1-C-2B에서 이 상태를 우회하기 위해 임의 학생·offering 연결을 만들면 안 된다.

### offering 단위 초안

과목별 syllabus parsed text를 검토용 주제 목록으로 보여주는 별도 초안은 가능하지만, 현재 서비스 계약이나 DB row로 저장할 수 있는 상태는 아니다. 주차 번호가 없는 주제 목록을 1~15주로 균등 배치하거나 학습목표·평가주차를 추정하지 않는다.

### 구조화된 `course_weekly_plans`

현재 생성 불가. 주차별 원문 데이터가 확인된 뒤에만 생성할 수 있다.

## 1-C-2B 구현 계획과 분기

### A. syllabus가 offering과 정확히 연결되고 1~15주 데이터가 명시된 경우

1. `course_id`·`offering_id`·`source_syllabus_id`를 실제 FK로 확인한다.
2. 원문에 명시된 주차만 `course_weekly_plans`로 변환한다.
3. 각 row에 `week_number`, `content`, `learning_objectives`, 필요 시 `preview_guide`·`review_guide`·`assignment_json`을 기록한다.
4. 원문 근거가 약한 row는 `review_required=true`, `professor_confirmed=false`로 둔다.
5. 1~15주 중 원문에 없는 주차는 생성하지 않는다.
6. 생성 후 offering/week unique key, source syllabus, 주차 범위, 민감정보 포함 여부를 검증한다.

### B. syllabus는 있으나 offering 연결 또는 주차 구조가 불완전한 경우

현재 두 offering이 여기에 해당한다. 먼저 로컬 검토용 매핑 문서 또는 교수 확인 입력을 준비하고, DB weekly plan insert는 보류한다. course_id가 같다는 이유만으로 교수·학기·주차를 보완하지 않는다.

### C. syllabus 또는 주차 데이터가 없는 경우

weekly plan을 생성하지 않는다. 빈 배열이나 임의 placeholder row를 생성하지 않고 readiness를 blocked로 기록한다.

## 1-C-2B 진입 판단

현재는 **진행 금지/보류**다.

- 실제 학생용 로드맵: 불가
- `course_weekly_plans` 생성: 주차 근거 부족으로 불가
- student progress 생성: 학생 offering 연결이 없어 불가
- 추가 DB 변경: 금지
- 필요한 선행 조건: 두 syllabus의 1~15주 구조화 원문 또는 교수 확인 자료, 그리고 실제 학생의 검증된 offering 연결

## 개인정보·범위 제한

- 학생 식별정보와 UUID를 문서에 기록하지 않는다.
- 법학과 블루북은 전공 과목·학년·진로 추천 근거로만 사용한다.
- 블루북이나 syllabus만으로 실제 수강, 교수, 분반, 선수과목을 추정하지 않는다.
- 1-C-2A에서는 DB INSERT/UPDATE/DELETE, migration, RLS, 인증, UI, commit/push를 수행하지 않았다.
