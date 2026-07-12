# Weekly Roadmap Migration Review — 1-B-1

## 범위와 실행 제한

이 문서는 1-B-1의 읽기 전용 검토 결과다. Supabase MCP의 schema/table 목록, migration 목록, security/performance advisor만 조회했다. `execute_sql`, `apply_migration`, SQL Editor, `db push`, `migration up`, `db reset`은 사용하지 않았다. 실제 row 변경과 원격 schema 변경은 없다.

## 실제 DB와 1-A migration 비교

| 항목 | 실제 DB | migration 초안 | 판정 |
|---|---|---|---|
| `academic_terms` | 없음 | 신규 생성 | 충돌 없음 |
| `course_offerings` | 없음 | 신규 생성 | 충돌 없음 |
| `course_weekly_plans` | 없음 | 신규 생성 | 충돌 없음 |
| `student_course_progress` | 없음 | 신규 생성 | 충돌 없음 |
| `student_weekly_progress` | 없음 | 신규 생성 | 충돌 없음 |
| `student_profiles.is_onboarded` | 없음 | not null + false 기본값 | 기존 row 보존 가능 |
| `student_courses.offering_id` | 없음 | nullable uuid FK | 기존 row 보존 가능 |
| `chat_sessions.offering_id` | 없음 | nullable uuid FK | 기존 row 보존 가능 |
| `escalations.offering_id` | 없음 | nullable uuid FK | 기존 row 보존 가능 |
| `counseling_requests.offering_id` | 없음 | nullable uuid FK | 기존 row 보존 가능 |
| `professor_availability.specific_date` | 없음 | nullable date | drift 복구 필요 |
| `professor_availability.day_of_week` | non-null integer | nullable로 변경 | 특정 날짜 슬롯을 위해 필요 |

현재 실제 migration 목록에는 초기 MVP 및 demo access 관련 8개 migration만 있고, foundation migration은 적용되지 않았다.

## 1-B-1에서 수정한 SQL 결정

### `academic_terms` nullable unique

`unique(school_id, semester_label)`은 PostgreSQL에서 `school_id IS NULL`인 전역 학기를 여러 개 허용한다. 따라서 단일 table constraint 대신 아래 두 partial unique index로 분리했다.

- 학교가 지정된 학기: `(school_id, semester_label) WHERE school_id IS NOT NULL`
- 학교가 없는 전역 학기: `semester_label WHERE school_id IS NULL`

### `course_offerings` 중복

`section_label`이 nullable이므로 `coalesce(section_label, '')`를 포함한 unique expression index를 유지한다. 같은 과목·교수·학기·분반이 중복 생성되지 않도록 한다.

### drift column과 FK

모든 offering 연결은 nullable이다. 기존 row를 추정해 backfill하지 않으며, `ON DELETE SET NULL`로 offering 삭제가 기존 질문·상담·대화 row를 삭제하지 않게 한다. `course_weekly_plans.source_syllabus_id`도 syllabus 삭제 시 `SET NULL`이다. 학생 progress는 학생 profile 삭제 시 개인 데이터가 함께 제거되는 `CASCADE`를 사용하므로, 실제 적용 전 계정 삭제 정책을 승인받아야 한다.

### check와 JSONB

- term 날짜: `starts_on <= ends_on`
- 주차: 1~60
- 난이도·이해도: 1~5
- confidence: 0~1
- progress status: 정의된 문자열 집합만 허용
- `learning_objectives`는 빈 배열 기본값
- guide/assignment JSON은 아직 입력이 없을 수 있어 nullable

### trigger

새 테이블은 기존 `public.set_updated_at()`을 사용한다. 이 함수가 실제 DB에 존재하는지는 table-list API가 함수 목록을 반환하지 않으므로 1-B-2 사전 검증 query에서 확인해야 한다. trigger 이름은 테이블별로 고유하다.

### RLS와 권한

새 테이블은 RLS만 켜고 `public`, `anon`, `authenticated`에 직접 권한을 부여하지 않는다. `auth.uid()` 정책도 만들지 않는다. 현재 인증은 Supabase Auth가 아닌 demo cookie이므로, 지금 authenticated 정책을 추가하면 실제 앱 인증 흐름과 충돌하거나 의도하지 않은 접근 경로가 생길 수 있다. Supabase Auth 전환 후 별도 migration에서 소유권·교수 offering 범위 정책을 추가한다.

### SECURITY DEFINER

이번 migration에는 `SECURITY DEFINER` 함수가 없다. RLS 우회나 public schema 함수 endpoint를 만들지 않는다.

## 현재 위험 요소

Supabase security advisor가 기존 `public.professor_admin_tasks`의 authenticated 정책을 `USING(true)` 및 `WITH CHECK(true)`로 경고한다. 이는 이번 foundation migration의 객체가 아니므로 1-B-1에서 수정하지 않았다. 별도 보안 migration에서 역할·교수 소유권 검증을 설계하고 승인해야 한다.

## 실제 적용 전 필수 검증(1-B-2)

1. `public.set_updated_at()` 함수 존재와 `search_path` 확인
2. 새 테이블·컬럼·FK·index·trigger·RLS 상태 확인
3. `academic_terms` partial unique index의 NULL/non-NULL 중복 동작 확인
4. 기존 row 수가 migration 전후 변하지 않는지 확인
5. `anon`/`authenticated`에 새 테이블 권한이 없는지 확인
6. constraint 이름·index 이름 중복 여부 확인
7. 적용 전 backup과 rollback 승인 확인

## 결론

현재 초안은 실제 DB의 확인된 drift와 demo auth 제약에 맞게 수정되었다. 하지만 아직 적용 안전성이 최종 승인된 것은 아니다. 1-B-2에서 사전 검증 SQL을 별도로 검토한 뒤에만 실제 migration 적용을 판단한다.
