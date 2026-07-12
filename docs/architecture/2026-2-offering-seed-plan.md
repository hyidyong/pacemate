# 2026-2 개설강좌·학생 수강 연결 seed 계획

## 범위와 상태

이 문서는 1-C-1A의 로컬 검토용 SQL 초안이다. SQL은 실제 Supabase에 실행하지 않는다. 기존 courses, professors, student_courses의 관계를 읽어 확정 가능한 offering만 제안하며, 블루북은 과목명·학년·진로 흐름의 보조 근거로만 사용한다.

확인 프로젝트는 Supabase `pacemate` (`szztsqdnvenfbgxtylkl`)다. 조회는 Supabase MCP read-only로 수행했고, DB·migration·RLS·인증·UI는 변경하지 않았다.

## 2026-2 학기 확정값

| 항목 | 값 | 근거/상태 |
| --- | --- | --- |
| `school_id` | `862b661c-810a-4440-ba76-722b2fcf8d6a` | 실제 `schools`의 계명대학교 row |
| `semester_label` | `2026-2` | 작업 대상 |
| `starts_on` | `2026-09-01` | `academic-calendar-2026.ts`의 2학기 개시일(개강일) |
| `ends_on` | `2026-12-20` | 12월 21일 동계방학·계절학기 시작일의 직전 경계. 등록처 확인 필요 |
| `timezone` | `Asia/Seoul` | 프로젝트 계약 및 migration 기본값 |
| `total_weeks` | `15` | foundation migration 기본값. 학사 일정에 주차 수가 직접 표기되지 않아 확인 필요 |
| `is_active` | `false` | 실제 운영 전 seed 초안이므로 활성화하지 않음 |

## 생성 예정 `course_offerings`

다음 두 후보만 `course_professors`와 `professor_teaching_slots`에서 모두 `2026-2`로 확인됐다.

| 과목 | `course_id` | 교수 | `professor_id` | 확인 근거 |
| --- | --- | --- | --- | --- |
| 회사법 | `6a9d0d8d-7010-4470-8af3-a72e09c59e88` | 김재두 | `7633254b-18cb-483d-a163-72eee0f22c97` | `course_professors.semester_label=2026-2`, 시간표 2건도 `2026-2` |
| 행정절차와행정구제 | `72170705-9609-456c-91fd-664b03c5a4ac` | 김영수 | `022a2f9b-f1ac-473e-a145-8cabd31419e5` | `course_professors.semester_label=2026-2`, 시간표 2건도 `2026-2` |

분반 번호는 실제 데이터에서 확인되지 않아 `section_label`을 만들지 않는다. 강의별 시작·종료일 override도 확인되지 않아 null로 둔다.

## `student_courses` 연결 결과

실제 `student_courses`에서 회사법 `course_id`(`6a9d0d8d-7010-4470-8af3-a72e09c59e88`)를 가진 row가 0건으로 확인됐다. 따라서 학생 연결 예정 수는 0건이며, student_courses UPDATE와 신규 row 생성은 SQL에서 제거했다.

기존 계획에서 회사법으로 오인한 row의 실제 과목은 민사소송법(1)(`66c552b1-6094-4bd9-b307-4a45d33119c4`)이다. 회사법과 다른 과목이므로 수강 연결 근거로 사용하지 않는다.

## unresolved 항목

- `academic_terms`가 현재 비어 있어 term row 자체는 seed SQL에서 생성 예정이다.
- 종료일은 동계방학 시작일의 직전 날짜로 경계를 잡았으나, 학사 일정 원문에 “2학기 종강/종료”가 별도 표기되지 않아 등록처 확인이 필요하다.
- `total_weeks=15`는 foundation migration 기본값이며 원 학사 일정의 명시값이 아니다.
- 담보물권법은 학생 관심 row와 교수·시간표 데이터가 있으나 semester label이 `2026학년도`이고 2026-2로 일치하지 않아 offering 후보에서 제외한다.
- 민법사례연습, 법문서작성은 기존 학생 관심 row 또는 course row가 있으나 2026-2 교수·시간표 연결이 확인되지 않아 제외한다.
- 부동산거래와건강한경제생활은 법학과 블루북의 과목명과 직접 일치한다고 추정하지 않으며, offering 후보로 만들지 않는다.
- 학생 이름, 이메일, 학번은 계획 문서에 기록하지 않는다. 회사법 student_courses row가 없어 student UUID도 기록하지 않는다.

## 블루북 사용 원칙

`src/data/bluebooks/law.json`과 `docs/architecture/bluebook-law-source-map.md`는 전공 교육과정, 과목명, 학년·학기 및 진로별 추천 흐름 확인에만 사용한다. 블루북만으로 2026-2 개설 여부, 담당 교수, 분반, 실제 학생 수강을 결정하지 않는다. 실제 개설·교수·학생 연결은 Supabase의 `courses`, `course_professors`, `professors`, `professor_teaching_slots`, `student_courses` 관계만 근거로 한다.

## SQL 파일

- `supabase/seed/2026-2-weekly-roadmap-foundation.sql`
- 실제 실행 금지: `DELETE`, `TRUNCATE`, `DROP` 없이 term/offering 생성 후보만 포함하며, `student_courses` 연결은 0건이다.
- 파일 끝의 SELECT는 실행 후 검토용이며, 이 단계에서는 SQL 파일의 정적 검토만 수행한다.

## 다음 단계 제한

1-C-1B 이후에는 추가 입력을 수행하지 않는다. migration 생성·적용, 기존 UI·인증 코드 수정, commit/push는 이 단계 범위가 아니다.

## 1-C-1B 실행 결과

- 실행 일시: 2026-07-12 18:55:18 +09:00 (Asia/Seoul)
- 대상 프로젝트: Supabase `pacemate` (`szztsqdnvenfbgxtylkl`)
- `academic_terms` insert: 1건
- `course_offerings` insert: 2건
- `student_courses` 변경: 0건
- 생성된 `term_id`: `783bfca3-3dae-400c-b6e8-08683c4ba3db`
- 생성된 offering: 회사법 `d0761612-d2db-413a-a800-1d554a6876eb`, 행정절차와행정구제 `228bb6cc-497c-4065-bf83-c9b0d906812c`
- offering UUID는 실제 FK 확인용으로만 기록하며 학생 식별 UUID는 기록하지 않는다.
- 검증: term 값 전체 일치, 두 offering의 `section_label`·시작일·종료일 override null, `student_courses` row count 6 유지, 회사법 student row 0건 유지
- RLS·policy·grant·schema·migration·function·trigger 변경 없음
- `ends_on=2026-12-20`, `total_weeks=15`는 등록처 확인 전 임시 운영값이다.
