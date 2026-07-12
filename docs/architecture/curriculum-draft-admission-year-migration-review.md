# curriculum draft admission-year migration 검토 (1-D-5B-0)

## 기존 제약 문제

현재 `curriculum_versions.admission_year_from`은 `NOT NULL`이고, 기존 `curriculum_versions_year_order`는 시작연도와 종료연도가 모두 범위 안에 있어야 한다. 전자공학과 Bluebook은 `source_academic_year=2026`만 확인하며, 적용 입학연도 시작값은 확인하지 못했다. 두 연도를 동일하다고 추정하면 안 되므로 현재 전자공학과 draft seed는 실행 전에 중단된다.

## 보완 원칙

- `draft`: `admission_year_from=NULL`, `admission_year_to=NULL` 허용
- `active`: `admission_year_from` 필수
- `admission_year_to`가 있으면 `admission_year_from`이 존재하고 종료연도 이상이어야 함
- 시작연도·종료연도는 1900~2200 범위를 유지
- `source_verified`를 active의 추가 필수 조건으로 강제하지 않음. 현재 승인 workflow가 별도이므로 과도한 제약을 추가하지 않았다.
- `archived`는 과거 보존을 위해 시작연도 NULL을 허용

## 생성 migration

- `supabase/migrations/20260712134054_allow_null_admission_year_for_draft_curricula.sql`
- `npx supabase migration new --help` 확인 후 `npx supabase migration new allow_null_admission_year_for_draft_curricula`로 생성
- 기존 `20260712120940_curriculum_graduation_foundation.sql`은 수정하지 않음
- `admission_year_from`의 NOT NULL 제거
- 기존 `curriculum_versions_year_order` constraint 제거 후 `curriculum_versions_admission_year_state_check` 추가
- active NULL 차단, 종료연도 단독 입력 차단, 역전 범위 차단
- NULL 범위 draft 중복을 막기 위해 `curriculum_versions_draft_null_range_idx` 추가
- 기존 위반 row를 먼저 검사하는 read-only `DO` block 포함

## 기존 데이터 영향

현재 read-only 확인에서 `curriculum_versions`는 0건이고 RLS는 활성화되어 있다. 원격 migration history는 `20260712120940/curriculum_graduation_foundation`까지이며 이번 migration은 아직 적용되지 않았다. migration에는 backfill, 기존 row 수정, 삭제가 없으므로 기존 데이터 변경은 없다. 적용 중 위반 row가 발견되면 예외와 함께 전체 transaction이 rollback된다.

## RLS 및 권한

- RLS, policy, direct grant 변경 없음
- SECURITY DEFINER, function, view, student assignment 생성 없음
- 다른 테이블 변경 없음

## 적용 전 확인

1. 원격 migration history와 대상 project ref를 read-only 확인
2. `curriculum_versions`의 실제 column nullability와 기존 constraint/index 확인
3. active 상태인데 시작연도가 NULL인 row가 없는지 확인
4. 종료연도만 있거나 시작연도보다 작은 종료연도 row가 없는지 확인
5. `curriculum_versions` row count와 RLS 상태 확인
6. 전자공학과 import의 `sourceAcademicYear=2026`, admission range NULL을 유지할지 확인

## 적용 후 검증 쿼리(실행하지 않음)

```sql
select column_name, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'curriculum_versions'
  and column_name in ('admission_year_from', 'admission_year_to');

select conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'public.curriculum_versions'::regclass
  and conname in ('curriculum_versions_year_order', 'curriculum_versions_admission_year_state_check');

select count(*) as invalid_active_rows
from public.curriculum_versions
where status = 'active' and admission_year_from is null;

select count(*) as invalid_end_only_or_reversed_rows
from public.curriculum_versions
where admission_year_to is not null
  and (admission_year_from is null or admission_year_to < admission_year_from);
```

기대값은 `draft`의 시작연도 NULL 허용, `active`의 시작연도 NULL 0건, 종료연도 단독·역전 0건이다. 새 partial unique index와 RLS 상태도 read-only로 확인한다.

## rollback

이번 단계에서는 migration을 적용하지 않으므로 rollback을 실행하지 않는다. 향후 적용 후 되돌림이 필요하면 별도 compensating migration으로 현재 데이터의 NULL draft 존재 여부를 먼저 확인해야 한다. 기존 migration 파일을 수정하거나 수동 데이터 backfill로 되돌리지 않는다.

## 전자공학과 draft seed

1-D-5B-0 migration 적용 후에는 전자공학과 draft version이 `admission_year_from=NULL`, `admission_year_to=NULL`, `status=draft`, `source_verified=false`로 저장될 수 있다. 41개 과목 draft seed SQL은 이 구조를 사용하며, `course_id/credits/recommended_semester` NULL과 `is_required=false`를 유지한다. 실제 seed 실행은 별도 승인 단계에서만 수행한다.

active 전환, 학생 자동 배정, 공식 졸업 진행률 계산, course catalog 생성은 계속 금지한다.

## 1-D-5B-1 migration 안전성 검토 결과

검토 대상은 `supabase/migrations/20260712134054_allow_null_admission_year_for_draft_curricula.sql`과 현재 마스터 로드맵이다. 이번 검토에서는 실제 DB 적용, `supabase db push`, seed 실행을 하지 않았다. 원격 `curriculum_versions`가 0건이라는 기존 read-only 확인 결과를 적용 위험 판단의 전제로 삼았다.

### 허용·차단 케이스

| 케이스 | 기대 결과 | 근거 |
| --- | --- | --- |
| `status=draft`, `admission_year_from=NULL`, `admission_year_to=NULL` | 허용 | 새 state check의 active 조건을 통과하고 NULL draft partial unique index로 중복을 제어한다. |
| `status=archived`, `admission_year_from=NULL`, `admission_year_to=NULL` | 허용 | state check는 `status <> 'active'`에 시작연도 NULL을 허용한다. 기존 archived 보존 목적과 일치한다. |
| `status=active`, `admission_year_from=NULL` | 차단 | `(status <> 'active' or admission_year_from is not null)` 조건을 위반한다. |
| 모든 상태, `admission_year_from=NULL`, `admission_year_to=2026` | 차단 | 종료연도가 있으면 시작연도가 NULL일 수 없도록 검사한다. |
| 모든 상태, `admission_year_from=2027`, `admission_year_to=2026` | 차단 | `admission_year_to between admission_year_from and 2200` 조건을 위반한다. |
| 모든 상태, 시작연도 또는 종료연도가 1900~2200 밖 | 차단 | 새 state check의 연도 범위 조건을 위반한다. |
| `status=active`, 유효한 시작·종료 범위, 기존 active range와 동일 | 차단 | 기존 `curriculum_versions_active_range_idx` unique partial index가 계속 적용된다. |
| `status=draft`, 시작연도 유효, 종료연도 NULL | 허용 | 기존 identity unique index와 새 state check 모두 유효하다. |
| NULL 시작·종료연도 draft가 같은 `school_id`, `department_id`, `version_key`로 재입력 | 차단 | `curriculum_versions_draft_null_range_idx`가 해당 세 컬럼 범위에서 중복을 막는다. |
| NULL 시작·종료연도 draft가 다른 school/department/version_key | 허용 | partial index의 의도된 식별 범위가 다르다. |

### 항목별 판정

| 검증 항목 | 판정 | 상세 |
| --- | --- | --- |
| 1. draft/archived NULL 허용 | 통과 | status가 active가 아니면 시작연도 NULL을 허용한다. |
| 2. active 시작연도 필수 | 통과 | state check가 INSERT/UPDATE 모두에서 강제한다. |
| 3. 종료연도만 존재 | 통과 | 시작연도 NULL과 종료연도 NOT NULL 조합을 차단한다. preflight도 기존 위반 row를 먼저 실패시킨다. |
| 4. 종료연도 < 시작연도 | 통과 | 새 check가 차단하며, preflight가 기존 위반도 감지한다. |
| 5. active unique/range 약화 여부 | 통과 | 기존 `curriculum_versions_active_range_idx`를 변경하지 않고, 새 index는 draft NULL 범위에만 partial 적용된다. 기존 identity index도 유지된다. |
| 6. NULL draft partial unique index | 통과 | `(school_id, department_id, version_key)`와 `status='draft'`, 양 연도 NULL predicate가 목표 범위와 일치한다. active와 연도 지정 draft에는 적용되지 않는다. |
| 7. 이름·의미 충돌 | 통과(주의) | 새 constraint/index 이름은 기존 migration의 이름과 다르다. `curriculum_versions_year_order`는 의미를 보존한 state check로 교체된다. 다만 외부 도구가 기존 constraint 이름을 직접 참조하는지 적용 전 확인해야 한다. |
| 8. DML/backfill/RLS/policy/grant/SECURITY DEFINER | 통과 | `DO` preflight는 read-only count만 수행하고, migration 본문에는 INSERT/UPDATE/DELETE/backfill, RLS·policy·grant, function/view/SECURITY DEFINER가 없다. |
| 9. transaction rollback | 통과 | `BEGIN`부터 `COMMIT`까지 DDL과 preflight가 하나의 transaction이다. preflight·ALTER·constraint/index 오류 시 COMMIT 전에 전체 transaction이 실패한다. |
| 10. 기존 row 0건 전제 | 통과(낮은 위험) | 기존 row가 0건이면 NOT NULL 완화와 constraint 교체가 기존 데이터에 영향을 주지 않는다. 적용 전 원격 row count와 metadata 재확인은 필수다. |

### 발견한 문제와 수정안

현재 migration을 막는 기능적 문제는 발견되지 않았다. 다만 다음 두 가지는 적용 전 운영 확인 항목으로 남긴다.

| Severity | 항목 | 영향 | 수정안 |
| --- | --- | --- | --- |
| LOW | `DROP CONSTRAINT ... IF EXISTS` 후 constraint 이름이 `curriculum_versions_admission_year_state_check`로 바뀜 | 이름을 직접 참조하는 외부 점검 스크립트가 있으면 조회 결과가 달라질 수 있다. 의미 자체는 원래의 연도 순서 제약보다 강화됐다. | migration 적용 전 외부 참조를 read-only 검색한다. 참조가 없으면 migration 본문 수정은 불필요하다. |
| LOW | `CREATE UNIQUE INDEX IF NOT EXISTS`는 같은 이름의 잘못된 기존 index가 있으면 조용히 건너뛸 수 있음 | 비정상적인 사전 객체가 있는 환경에서는 의도한 partial predicate가 보장되지 않을 수 있다. 현재 원격 신규 테이블·0건 전제에서는 가능성이 낮다. | 적용 직전 `pg_indexes`에서 이름·정의·predicate를 read-only 확인한다. 불일치 시 적용을 중단하고 별도 수정 migration을 검토한다. |

두 항목 모두 현재 파일의 즉시 수정이 필요한 결함은 아니며, 적용 전 사전 검증으로 해소할 수 있다. 기존 migration 본문은 변경하지 않고 1-D-5B-2에서 확인한다.

### 1-D-5B-2 진행 판단

조건부 진행 가능이다. 다음을 read-only로 확인한 뒤에만 실제 적용을 승인한다.

1. 원격 프로젝트와 migration history가 예상값인지 확인한다.
2. `curriculum_versions` row count가 0건인지 재확인한다.
3. `curriculum_versions_year_order`의 존재 여부와 기존 active range/identity index 정의를 확인한다.
4. 새 index 이름이 이미 존재하지 않거나 정의가 정확히 일치하는지 확인한다.
5. RLS, policy, grant, 함수, trigger 변경이 없는지 migration diff를 재확인한다.

이 조건을 충족하면 migration 적용 자체는 낮은 위험으로 판단한다. 단, 적용 후에도 전자공학과 draft seed 실행(1-D-5C)은 별도 preflight와 승인 이후에만 진행한다.
