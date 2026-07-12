# 교육과정·졸업요건 공통 DB 설계 (1-D-1)

## 범위와 원칙

법학과와 전자공학과 블루북을 같은 구조로 수용하되, PDF에 없는 규칙을 추론하지 않는다. 교육과정 버전, 입학연도 적용 범위, 학생 유형 예외, 과목 인정 이력, 진로 트랙을 분리한다. 학생이 입력하는 값은 과목명이 아니라 서버가 반환한 식별자만 사용한다.

이번 단계는 설계 문서만 작성한다. 아래 제안 테이블은 실제로 생성하지 않았고, 기존 테이블의 데이터도 변경하지 않았다.

## 현재 Supabase schema read-only 확인

확인 대상 프로젝트의 현재 상태는 다음과 같다.

| 테이블 | 확인 결과 | 설계상 처리 |
| --- | --- | --- |
| `schools` | 존재, 1 row | 재사용 |
| `departments` | 존재, 1 row | 재사용 |
| `courses` | 존재, 9 rows | 재사용. 블루북 과목과 자동 이름 매칭 금지 |
| `student_profiles` | 존재, 11 rows | 입학연도·학생 유형의 현재 저장 위치로 재사용하되 컬럼 확장은 보류 |
| `student_courses` | 존재, 6 rows | 수강/관심/추천 상태와 교육과정 인정 상태를 혼용하지 않음 |
| `profiles` | 존재, 23 rows | 학생 FK 및 검증자 FK의 기준 |
| 제안 9개 테이블 | 모두 미존재 | 후속 migration 후보 |

현재 `student_courses.status` enum은 `completed`, `interested`, `recommended`다. `recognized`, `not_completed`를 이 enum에 임의로 추가하지 않는다. 공식 성적·편입 인정은 별도 `student_course_records`에서 표현한다.

## 제안 테이블 목록

### `curriculum_versions`

교육과정 원본의 버전과 적용 범위를 나타낸다.

| 항목 | 설계 |
| --- | --- |
| 필요성 | 필수. 입학연도와 개정본을 분리해야 함 |
| PK | `id uuid` |
| FK | `school_id → schools.id`, `department_id → departments.id`, 선택 `created_by → profiles.id` |
| 주요 컬럼 | `version_key`, `version_label`, `admission_year_from`, `admission_year_to`, `student_type_scope`, `status`, `source_file`, `source_edition`, `source_hash`, `effective_from`, `effective_to`, timestamps |
| 상태 | `draft`, `published`, `retired` |
| unique | 학교·학과·version_key. 적용 범위가 겹치는 published 버전은 별도 검증으로 차단 |
| nullable | `admission_year_to`, `source_edition`, `effective_to`, `created_by`는 nullable |
| 개인정보 | 학생 개인정보 없음 |
| RLS/server-only | 초기에는 RLS enable + public/anon/authenticated 권한 revoke, 서버 전용 조회 |

### `curriculum_courses`

특정 버전에서 과목이 어떤 요구 유형과 권장 학기·학년에 배치되는지 저장한다.

| 항목 | 설계 |
| --- | --- |
| 필요성 | 필수. `courses`의 전역 카탈로그와 버전별 배치를 분리 |
| PK | `id uuid` |
| FK | `curriculum_version_id → curriculum_versions.id`, `course_id → courses.id` |
| 주요 컬럼 | `requirement_type`, `recommended_grade`, `recommended_semester`, `credits_override`, `source_course_name`, `source_page`, `is_explicit`, timestamps |
| 상태 | row 자체는 version 상태를 따름. 불확실한 매칭은 별도 unresolved 기록 |
| unique | version·course·requirement_type·학기 조합. 같은 과목의 여러 역할은 명시적으로 별도 row |
| nullable | `course_id`는 매칭 전 임시 import 검토를 허용하려면 nullable이지만 published 전에는 필수로 검증 |
| 개인정보 | 없음 |
| RLS/server-only | 서버 전용 |

`requirement_type` 예시는 `major_required`, `major_selective`, `general_required`, `general_selective`, `elective`, `language`, `other`다. PDF가 전공필수를 명시하지 않은 과목을 필수로 승격하지 않는다.

### `curriculum_requirements`

졸업학점·필수 이수·언어·P/F·졸업시험처럼 과목 목록만으로 계산할 수 없는 규칙을 저장한다.

| 항목 | 설계 |
| --- | --- |
| 필요성 | 필수. 학점 합계와 조건부 요건을 구조화 |
| PK/FK | `id uuid`; `curriculum_version_id → curriculum_versions.id` |
| 주요 컬럼 | `code`, `name`, `requirement_type`, `rule_definition jsonb`, `display_order`, `source_page`, `is_auto_checkable`, `status`, timestamps |
| unique | version·code |
| rule_definition | 숫자 비교, course set, 언어 점수, P/F 등 검증 가능한 원문 규칙만 저장 |
| 상태 | `draft`, `published`, `unresolved` |
| 개인정보/RLS | 개인정보 없음, 서버 전용 |

JSONB는 규칙의 매개변수를 담는 용도로만 사용한다. 상태·버전·FK·검증자 같은 핵심 무결성 필드를 JSONB에 넣지 않는다.

### `curriculum_requirement_exceptions`

편입생, 복수전공, 부전공, 입학연도 차이 등 기본 규칙의 예외를 저장한다.

| 항목 | 설계 |
| --- | --- |
| 필요성 | 필수. 예외를 코드 if문으로 하드코딩하지 않음 |
| PK/FK | `id uuid`; `curriculum_version_id → curriculum_versions.id` |
| 주요 컬럼 | `code`, `scope_type`, `admission_year_from/to`, `student_type`, `condition jsonb`, `effect jsonb`, `priority`, `source_page`, `status`, timestamps |
| unique | version·code |
| 상태 | `draft`, `published`, `unresolved` |
| 개인정보 | 학생 row를 직접 저장하지 않음 |
| RLS/server-only | 서버 전용. 학생에게 적용된 결과만 반환 |

조건이 겹치면 `priority`와 가장 구체적인 범위를 사용하되, 동일 우선순위 충돌은 자동 결정하지 않고 `manual_review`로 반환한다.

### `course_equivalencies`

과목 코드 변경·동일 과목·공식 대체 인정 관계를 별도로 관리한다.

| 항목 | 설계 |
| --- | --- |
| 필요성 | 조건부. 실제 공식 동등·대체 근거가 있을 때만 필요 |
| PK/FK | `id uuid`; `source_course_id`, `target_course_id → courses.id`; 선택 `curriculum_version_id` |
| 주요 컬럼 | `equivalence_type`, `condition jsonb`, `source_page`, `is_verified`, `verified_by → profiles.id`, `verified_at`, status |
| unique | version·source·target·equivalence_type |
| 개인정보/RLS | 검증자 FK 외 개인정보 없음, 서버 전용 |

단순 과목명 유사성은 equivalency가 아니다. 블루북에 없는 대체 관계는 unresolved로 둔다.

### `career_tracks`

법학과의 로스쿨·변호사시험, 법무사, 공인노무사, 공인중개사, 감정평가사, 변리사, 검찰·법원·경찰 등 진로와 전자공학과의 원문 진로 트랙을 저장한다.

| 항목 | 설계 |
| --- | --- |
| 필요성 | 권장. 진로 추천을 졸업요건과 분리 |
| PK/FK | `id uuid`; `curriculum_version_id → curriculum_versions.id` |
| 주요 컬럼 | `track_key`, `name`, `category`, `description`, `source_page`, `status`, timestamps |
| unique | version·track_key |
| 상태 | `draft`, `published`, `unresolved` |
| 개인정보/RLS | 없음, 서버 전용 |

### `career_track_courses`

진로 트랙과 과목의 권장 순서·근거를 연결한다.

| 항목 | 설계 |
| --- | --- |
| 필요성 | 권장. 진로별 추천과 공식 선수과목을 구분 |
| PK/FK | `id uuid`; `career_track_id → career_tracks.id`, `curriculum_course_id → curriculum_courses.id` 또는 `course_id → courses.id` |
| 주요 컬럼 | `sequence_grade`, `sequence_semester`, `recommendation_type`, `source_page`, `is_explicit`, `status`, timestamps |
| unique | track·course·sequence 조합 |
| 상태 | `draft`, `published`, `unresolved` |
| 보안 | 서버 전용 |

블루북의 화살표·학년 순서는 `recommended_sequence`로만 저장한다. PDF가 명시하지 않은 법적 prerequisite는 생성하지 않는다.

### `student_curriculum_assignments`

학생에게 적용할 curriculum version을 서버가 결정한 결과를 저장한다.

| 항목 | 설계 |
| --- | --- |
| 필요성 | 필수. 적용 버전을 매 요청마다 재추정하지 않음 |
| PK/FK | `id uuid`; `student_id → profiles.id`, `curriculum_version_id → curriculum_versions.id`, 선택 `assigned_by → profiles.id` |
| 주요 컬럼 | `admission_year`, `student_type`, `assignment_reason`, `status`, `is_manual_override`, `needs_review`, timestamps |
| unique | 학생별 active assignment 1건(부분 unique index) |
| 상태 | `active`, `superseded`, `manual_review` |
| 개인정보/RLS | 학생 FK와 입학연도는 개인정보 범주로 보고 server-only. 학생 본인 조회 정책은 Auth 전환 후 별도 설계 |

현재 `student_profiles`의 `user_types`, `grade`, `semester`를 입력으로 사용하되, 최종 assignment는 이력 row로 고정한다. `student_profiles`에 새 컬럼을 추가하는 것은 후속 migration에서 별도 검토한다.

### `student_course_records`

학생의 공식 이수·인정·미이수 상태를 교육과정 기준으로 저장한다.

| 항목 | 설계 |
| --- | --- |
| 필요성 | 필수. `student_courses`의 관심·추천·수강 상태와 분리 |
| PK/FK | `id uuid`; `student_id → profiles.id`, `curriculum_course_id → curriculum_courses.id`, 선택 `course_id → courses.id`, `verified_by → profiles.id` |
| 주요 컬럼 | `status`, `credits_earned`, `recognition_source`, `completed_term`, `grade`, `is_verified`, `verified_at`, `source_reference`, timestamps |
| 상태 | `completed`, `recognized`, `not_completed`, `unresolved` |
| unique | 학생·curriculum_course·근거 버전. 재평가 이력이 필요하면 revision을 추가 |
| nullable | `grade`, `completed_term`, `verified_by`는 인정 방식에 따라 nullable |
| 개인정보/RLS | 학생 학업정보이므로 server-only. 본인 조회 외 직접 Data API 노출 금지 |

`student_courses.status=completed`만으로 졸업요건을 확정하지 않는다. 공식 성적 또는 검증된 인정 기록이 `is_verified=true`일 때만 계산에 포함한다.

## 기존 테이블 재사용 범위

- `schools`, `departments`: 학교·학과의 정규 FK로 사용한다.
- `courses`: 전역 과목 catalog로 사용한다. 블루북 과목과의 매칭은 코드·학과·학점·명칭·source page를 함께 검토한다.
- `student_profiles`: 현재 입학연도 컬럼이 없으므로 원문 입력/assignment 결정 전에 필요한 필드는 unresolved 또는 별도 onboarding 입력으로 둔다.
- `student_courses`: 관심·추천·기존 수강 데이터 보존. 교육과정 인정 상태를 덮어쓰지 않는다.
- `profiles`: 학생 및 검증자 FK의 기준. 이름·identifier는 설계 문서나 bluebook import에 복사하지 않는다.

## RLS와 server-only 정책

초기 import·assignment·졸업 계산은 server-only service layer에서 수행한다. 현재 foundation migration이 신규 주간 로드맵 테이블에 RLS를 활성화하고 `public`, `anon`, `authenticated` 직접 권한을 제거한 원칙을 그대로 적용한다. 실제 Supabase Auth 전환 후 학생 본인 조회 정책을 추가할 때는 `auth.uid()`와 행 소유권을 함께 검사하며, `TO authenticated`만으로 공개하지 않는다. service-role key는 client에 노출하지 않는다.

## migration 후보와 보류 항목

후속 `1-D-2`에서 제안 테이블, enum/check, FK, unique index, updated_at trigger, RLS baseline을 migration으로 만들 수 있다. 단, 다음은 migration 전에 확정해야 한다.

1. 학과별 입학연도 범위와 공식 curriculum version 식별자
2. 전자공학과 PDF의 과목·졸업요건 원문 추출 및 검토
3. `courses` catalog와 블루북 과목의 exact match 목록
4. 학생 입학연도·편입·복수전공·부전공을 공급할 authoritative source
5. 공식 성적·편입 인정 데이터의 import 및 검증 주체

위 항목이 확정되기 전에는 migration, seed, 기존 row 수정, 졸업판정 자동화를 진행하지 않는다.
