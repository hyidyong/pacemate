# 교육과정·졸업요건 migration 검토 (1-D-2A)

## 검토 범위

- 생성 migration: supabase/migrations/20260712115133_curriculum_graduation_foundation.sql
- 생성 방법: npx --yes supabase@2.109.1 migration new curriculum_graduation_foundation
- 근거 문서: curriculum-graduation-schema.md, curriculum-onboarding-flow.md, bluebook-data-import-guide.md
- 기존 foundation: supabase/migrations/20260712000000_weekly_roadmap_foundation.sql
- 실제 DB: read-only schema 확인만 수행. migration apply, execute_sql, seed는 수행하지 않음

## 생성 테이블

다음 9개 테이블만 additive하게 생성하도록 작성했다.

1. curriculum_versions
2. curriculum_courses
3. curriculum_requirements
4. curriculum_requirement_exceptions
5. course_equivalencies
6. career_tracks
7. career_track_courses
8. student_curriculum_assignments
9. student_course_records

기존 schools, departments, courses, profiles를 FK target으로 재사용하며 기존 테이블의 column·row·constraint는 변경하지 않는다.

## 기존 schema와의 연결

read-only 확인된 기존 PK/FK 관계는 다음과 같다.

- departments.school_id → schools.id
- courses.school_id → schools.id
- courses.department_id → departments.id
- student_profiles.profile_id → profiles.id
- student_courses.student_id → profiles.id
- student_courses.course_id → courses.id

학생 식별은 제안 테이블에서 profiles.id FK만 사용한다. 학생 이름, identifier, 이메일, UUID를 블루북 원문이나 source JSON에 복제하지 않는다.

## 핵심 설계 검토

### curriculum_versions

- 학교·학과 FK, version key/label, admission year 범위, draft/active/archived 상태를 가진다.
- source_title, source_file, source_academic_year, source_edition, publication_date, source_verified를 별도로 보존한다.
- 동일 학교·학과·version·적용 범위 중복을 unique index로 제한하고, 동일 학과·동일 범위의 active 중복을 partial unique index로 제한한다.
- 전자공학과는 source_academic_year=2026, publication_date=null로 기록할 수 있다. 발행일과 published 승인은 별개다.

### curriculum_courses

- course_id는 nullable이다. 정확한 courses 매칭 전에도 source_course_name과 page를 보존할 수 있다.
- requirement_type, grade/semester, credits, is_required, sort order, metadata를 저장한다.
- source name 기반 import가 기존 courses FK를 자동 추정하지 않도록 했다.
- source_course_name·요구 유형·권장 학기 조합 unique index로 중복 curriculum row를 방지한다.

### curriculum_requirements와 exceptions

- 단순 숫자는 typed column으로, 조건부 규칙은 object JSONB로 분리했다.
- JSONB에는 SQL이나 실행 코드가 들어가지 않는다.
- 편입·복수전공·부전공·재입학·학과 통합/분리 예외는 별도 table에서 priority와 manual review 여부를 가진다.

### course_equivalencies

- source/target course FK는 nullable이며 원문 이름·코드가 항상 보존된다.
- verified 전에는 unresolved 상태다. 과목명이 비슷하다는 이유로 equivalency를 만들 수 없다.

### career tables

- career_tracks와 career_track_courses로 진로 이름과 과목 순서를 분리했다.
- recommended_sequence는 prerequisite가 아니다.
- 법학과 로스쿨·변호사시험, 법무사, 공인노무사, 공인중개사, 감정평가사, 변리사, 검찰·법원·경찰 진로와 전자공학과의 후속 track을 같은 구조에 담을 수 있다.

### 학생 tables

- student_curriculum_assignments는 학생별 active 교육과정 적용을 저장하며 assignment type별 active 중복을 partial unique index로 제한한다.
- student_course_records에는 completed와 recognized만 저장한다. not_completed는 row 부재로 표현한다.
- self-report는 is_verified=false; 공식 학교 import 또는 관리자 확인 후에만 verified로 계산에 포함한다.
- 현재 student_courses의 interested/recommended/completed 의미를 덮어쓰지 않는다.

## RLS·grant·server-only

- 9개 신규 테이블 모두 RLS를 enable한다.
- public, anon, authenticated에 직접 grant나 policy를 추가하지 않는다.
- 현재 PaceMate demo session + server-only Supabase 접근 구조와 호환된다.
- service-role key를 client에 노출하거나 SECURITY DEFINER 함수를 만들지 않는다.
- 실제 Supabase Auth 전환 후 학생 본인 조회 정책을 별도 migration으로 설계한다.

## 위험 SQL 및 기존 데이터 영향

검토 결과 migration에는 다음이 없다.

- DROP, TRUNCATE, DELETE
- 기존 테이블의 ALTER COLUMN, DROP COLUMN, data backfill
- INSERT, UPDATE
- bluebook·student UUID·placeholder seed data
- public permissive policy, direct grant, view, SECURITY DEFINER function

모든 객체 생성은 transaction 안에 있다. future apply 중 오류가 나면 transaction 전체가 rollback되어야 하며, apply 이후 되돌림은 별도 검토된 compensating migration으로만 수행한다. 이번 단계에서는 rollback SQL을 실행하거나 작성하지 않는다.

## 적용 전 체크리스트

- [ ] 실제 대상 Supabase project ref가 맞는지 확인
- [ ] public.set_updated_at() helper의 실제 존재와 signature 확인
- [ ] 기존 schema와 FK type/삭제 정책 재확인
- [ ] partial unique index가 업무상 허용하는 version 범위와 일치하는지 검토
- [ ] course matching unresolved row를 published version에 포함하지 않을 것 확인
- [ ] 전자공학 source_academic_year=2026, publication_date=null 근거 확인
- [ ] 법학 sourceEdition null 및 최신성 warning 유지
- [ ] student records의 verified 주체와 공식 성적 source 결정
- [ ] Auth 전환 전에는 direct Data API grant/policy를 추가하지 않을 것 확인

## 검증 결과와 다음 단계

- supabase migration new --help: npx CLI 2.109.1로 확인
- migration 파일 생성: 성공
- 실제 DB 적용: 하지 않음
- git diff --check: 실행 후 통과
- lint/typecheck/build: 코드 변경이 없으므로 실행하지 않음

## 1-D-2B 최종 안전성 검토

- 기존 FK target은 실제 read-only schema와 일치한다: schools, departments, courses, profiles.
- 신규 FK마다 대상 column index를 추가했다. nullable course FK와 verified_by/resolved_by FK도 별도 index를 가진다.
- admission year, grade/semester, credits, status, JSONB object, verified 상태, active assignment 중복에 check/unique 제약을 둔다.
- `student_course_records.status`는 `completed`와 `recognized`만 허용하며, 미이수는 row 부재로 표현한다.
- `course_id`와 equivalency source/target FK는 nullable로 유지해 exact matching 전 unresolved 상태를 보존한다.
- verified 상태는 `verified_by`와 `verified_at`을 함께 요구하고, 미검증 상태에는 검증자 값을 넣을 수 없도록 check한다.
- demo 학생·교수·리포트 데이터와 `semester_reports` 구조는 migration에 포함하지 않는다.
- migration은 기존 table/data를 변경하지 않고 신규 table/index/RLS baseline만 생성한다.
- RLS는 신규 9개 table에 활성화되며 public/anon/authenticated policy와 direct grant는 없다.
- `SECURITY DEFINER`, view, seed, placeholder UUID는 없다.
- `public.set_updated_at()`은 기존 foundation이 사용하는 helper만 참조한다. `to_regprocedure`로 helper가 없으면 migration이 fail-closed 되며, 임의 helper나 SECURITY DEFINER를 생성하지 않는다.
- `before update`는 timestamp trigger 정의에만 사용되며, migration 실행 시 데이터 UPDATE 문은 없다.

## 1-D-2C 판단

**적용 가능(단, 이번 단계에서는 적용하지 않음).** schema는 법학과와 전자공학과를 담는 빈 공통 구조이므로 전자공학 원문 정규화와 `courses` exact matching은 migration 적용의 선행조건이 아니다. 해당 작업은 실제 curriculum seed와 published version 생성의 선행조건으로 별도 관리한다.

실제 적용 전에는 project ref, `public.set_updated_at()` helper의 실제 존재/signature, migration history, 대상 schema snapshot을 한 번 더 read-only 확인한다. 실제 DB 변경·migration apply는 다음 단계에서 별도 승인 후 수행한다.
