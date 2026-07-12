# 전자공학과 curriculum draft seed 검토 (1-D-5A)

## 적용 범위

- 대상 학교: `계명대학교`의 단일 school row를 이름으로 fail-closed 조회
- 대상 학과: `전자공학과` (현재 DB에는 department row가 없으며, SQL에는 조건부 생성문만 포함)
- 대상 판본: `electronic-engineering-2026`, `status=draft`, `academic_year=2026`
- 원본: `docs/reference/bluebooks/electronic-engineering/source.pdf`
- 이번 단계에서는 SQL 파일만 생성했다. 실제 DB, migration, 법학과, 학생·교수·리포트 데이터는 변경하지 않았다.

## seed 대상 수

| 항목 | 검토 결과 |
| --- | ---: |
| curriculum course | 41개 |
| 도식 배치 / 중복 배치 | 47 / 6 |
| SQL에 포함할 draft requirement | 12개 |
| hold requirement | 10개 |
| SQL에 포함할 exception | 8개 |
| 별도 hold exception row | 0개 |
| career track / track course | 0 / 0 |
| course equivalency | 0 |

41개 과목은 PDF 4쪽(인쇄 3쪽) 이미지 도식에서 이름과 학년만 확인했다. 모든 `course_id`, `credits`, `recommended_semester`는 `NULL`이고 모든 `is_required`는 `false`다. 필수·선택 근거가 없어 `requirement_type=other`를 사용했다. 도식 중복 6개는 별도 row가 아니라 `metadata.diagramLocations`에 보존했다.

## SQL 안전장치

- 생성 파일: `supabase/seed/2026-electronic-engineering-curriculum-draft.sql`
- 전체 transaction(`BEGIN`/`COMMIT`)이며, 1-D-5B-0 migration 적용 후 실행하는 것을 전제로 한다.
- 현재 import의 `admissionYearFrom=null`은 draft version에 그대로 저장한다. source academic year 2026을 admission year로 추정하지 않는다.
- 실제 `schools(school_id,name)` unique 조건을 이용해 전자공학과를 조건부 생성하고, draft version을 확인·재사용한다.
- curriculum course는 기존 count가 0일 때만 41개를 입력하고, 부분 입력·예상 외 count·중복 이름은 최종 검증에서 예외 처리한다.
- requirement는 원문 수치와 범위가 명확한 12개만 포함한다. `rule_definition._importMetadata`에 `verificationStatus`, `seedDisposition`, 자동 졸업계산 금지를 기록한다.
- 예외 8개는 모두 원문 근거를 보존해 draft row로 포함하되 `requires_manual_review=true`이며 자동 배정에 사용하지 않는다. 원본 JSON의 `seedDisposition=hold_for_confirmation` 의미는 실제 적용·자동판정 보류이며, draft row 보존 허용과 구분한다.
- `ON CONFLICT` 대상을 추측하지 않고 count 및 실제 identity 검증으로 idempotency를 구현한다. 부분 데이터는 fail-closed다.
- active version, course catalog row, career track, equivalency, student/profile/assignment/record/report row는 생성하지 않는다.

## hold requirement

다음 10개는 SQL에 넣지 않고 보류한다.

- 2003~2006, 2007~2009, 2010~2023 전자공학과 제1전공 최소학점
- 2003~2006, 2007~2009, 2010~2011, 2012~2023 제1전공·타전공 합계학점
- 전자공학과 지정 전공필수 전체 이수
- 전자공학과 교직 적용 여부
- 전자공학과 졸업논문·시험 등 학과별 요건

전자공학과 고유 적용과 과목 목록 또는 학생 유형 적용이 확정되지 않아 active 전환과 공식 졸업계산에 사용할 수 없다.

## 적용 전 read-only 확인

1. `schools`에서 `계명대학교`가 정확히 1건인지 확인
2. 해당 학교의 `departments`에 `전자공학과`가 0건 또는 정확히 1건인지 확인하고 2건 이상이면 중단
3. `courses`에 전자공학과 catalog row가 없는 현재 상태를 확인하고 course catalog를 seed하지 않음
4. 동일 `version_key` draft가 이미 있으면 row 수와 source/version 범위를 확인
5. 기존 curriculum course/requirement/exception이 부분적으로 존재하면 SQL을 실행하지 않음
6. 1-D-5B-0 migration이 적용되어 draft의 `admission_year_from=NULL`이 허용되는지 먼저 확인

## 적용 후 검증(실행하지 않음)

```sql
select status, academic_year, source_verified
from public.curriculum_versions
where version_key = 'electronic-engineering-2026';

select count(*) as course_count,
       count(*) filter (where course_id is null) as null_course_id_count,
       count(*) filter (where credits is null) as null_credits_count,
       count(*) filter (where recommended_semester is null) as null_semester_count,
       count(*) filter (where is_required = false) as not_required_count
from public.curriculum_courses
where curriculum_version_id = :version_id;
```

기대값은 course 41, 모든 `course_id/credits/recommended_semester` null, 모든 `is_required=false`, version `draft/source_verified=false`다. 학생 assignment와 course catalog 신규 row는 0건이어야 한다.

## rollback 및 사용 제한

- SQL 실행 중 오류가 발생하면 transaction 전체를 rollback하며, 기존 row를 임의로 삭제하거나 덮어쓰지 않는다.
- 시연에서 허용: draft 과목 목록·학년·도식 흐름의 읽기 전용 표시와 미확정 경고
- 시연에서 금지: active 전환, 학생 자동 배정, 공식 졸업 진행률 계산, 선수과목 판정, 학점 기반 판정, course catalog 자동 생성

`blocksActivation=true`, `blocksGraduationCalculation=true`를 유지한다. `blocksDraftSeed=false`는 41개 과목의 JSON draft 구조와 seed template 구성이 가능하다는 뜻이며, 실제 DB 적용은 admission-year 범위와 department FK 확인 이후에만 가능하다.

1-D-5B 실제 적용 검토는 **migration 적용 후 가능**하다. admission-year 범위는 계속 NULL로 보존하고, active 전환·학생 자동 배정·공식 졸업계산은 여전히 금지한다. 이번 단계에서는 migration과 seed SQL을 실행하지 않았다.
