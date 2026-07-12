# 주간 계획 승인 workflow 설계 (1-C-2D-A)

## 현재 상태

- `/professor/weekly-plan-preview`는 서버에서 Git JSON draft를 읽는 read-only 화면이다.
- 회사법과 행정절차와행정구제 draft는 각각 15주이며 `status=draft`, `source.verifiedByProfessor=false`다.
- 학생 production 조회는 `course_weekly_plans`만 읽고 draft를 병합하지 않는다.
- 실제 Supabase read-only 확인 결과: `course_weekly_plans` 0건, `course_offerings` 2건, `academic_terms` 1건이며 관련 테이블은 RLS가 활성화되어 있다.
- `professor_profiles` 테이블은 현재 존재하지 않는다. 교수 식별은 `professors.profile_id = profiles.id`로 해야 한다.
- 이 문서 단계에서는 DB, migration, UI, server action, mutation을 만들지 않는다.

## 권한 모델

### 승인 주체

MVP의 승인 주체는 해당 offering의 담당 교수 1명이다.

1. signed server session에서 `profileId`와 role을 확인한다.
2. role이 `professor`인지 확인한다.
3. `professors.profile_id = session.profileId`로 교수 row를 찾는다.
4. `course_offerings.professor_id = professors.id`인지 재검증한다.
5. offering의 `term_id`, `course_id`, draft의 `termId`, `courseId`, `offeringId`가 모두 일치하는지 확인한다.

`professor_id`나 `approved_by`를 client 입력으로 받지 않는다. 다른 교수의 offering은 위 소유권 검증에서 거부한다. `assistant`와 `admin`의 대리 승인은 MVP에서 허용하지 않고, 향후 별도 관리자 override 권한과 사유·감사 로그를 추가할 때만 검토한다. 따라서 현재 demo role만으로 DB 권한을 결정하지 않고, server-side session과 실제 FK 관계를 함께 검증한다.

## 승인 상태 모델

권장 상태는 다음과 같다.

| 상태 | 의미 | 학생 production 노출 |
| --- | --- | --- |
| `draft` | 파일 또는 revision 초안 | 금지 |
| `under_review` | 교수 검토 중 | 금지 |
| `approved` | 교수 검증을 통과한 현재본 | 허용 |
| `rejected` | 검토 메모와 함께 반려 | 금지 |
| `superseded` | 새 revision 승인으로 대체된 과거본 | 금지 |

현재 `course_weekly_plans`에는 `review_required`와 `professor_confirmed`만 있어 `approved`, 반려, 대체, 검토 이력, 승인자를 구분할 수 없다. 따라서 현재 스키마만으로 전체 workflow를 표현할 수 없다. `professor_confirmed=true`는 승인 완료의 결과 플래그로만 사용하고 상태의 단일 진실로 삼지 않는다.

### 필드 판단

| 필드 | 판단 | 위치/이유 |
| --- | --- | --- |
| `status` | 필요 | revision/approval 기록 테이블. 현재본과 반려·대체본 구분 |
| `approved_by` | 필요 | 승인한 `profiles.id`; 담당 교수 FK 검증과 감사 추적 |
| `approved_at` | 필요 | 승인 시각 |
| `source_type` | 필요 | `syllabus`와 향후 수동 수정 구분 |
| `source_version` | 필요 | Git draft 또는 revision 식별자. 내용 hash를 함께 저장하는 편이 안전 |
| `review_note` | 필요 | 반려·수정 요청·승인 메모 |
| `revision` | 필요 | 동일 offering의 재승인 순서 |
| `superseded_by` | 조건부 필요 | revision 이력을 별도 테이블로 두면 FK로 유용; MVP에서는 상태+revision으로도 가능 |
| `created_by` | 필요 | 초안/revision 제출자. 승인자와 분리 |
| `updated_at` | 필요 | revision 감사 추적 |

MVP에서는 이 메타데이터를 `course_weekly_plans`에 모두 억지로 추가하기보다 `course_weekly_plan_revisions`(또는 동등한 approval audit table)를 별도 migration으로 만들고, `course_weekly_plans`는 현재 approved 15주만 보관하는 방식을 권장한다.

## draft 저장 전략

| 방식 | 장점 | 단점 |
| --- | --- | --- |
| A. Git JSON 유지 | review diff, 재현성, 개인정보 통제, DB 오염 없음 | 비개발자 수정·승인 이력·동시 검토가 약함 |
| B. draft도 DB row 저장 | 상태·권한·댓글·이력 조회가 쉬움 | RLS와 draft/학생 경로 분리 필요, 초기 데이터와 schema 복잡도 증가 |
| C. Git JSON을 source로 유지하고 DB에는 승인본만 저장 | source 재현성과 production 안전성의 균형, 학생은 approved row만 조회 | 승인 시 source version/hash와 DB 반영 transaction 필요 |

현재 MVP의 권장안은 **C**다. 승인 전에는 Git JSON과 서버 preview만 사용하고, 승인 transaction이 검증한 15주만 `course_weekly_plans`에 기록한다. 학생 production은 approved current rows만 읽는다. 같은 offering/week는 unique key로 하나만 유지하고, 재승인은 revision audit를 남긴 뒤 current row를 원자적으로 교체한다.

## DB schema gap 및 JSON 매핑

현재 `course_weekly_plans` 컬럼은 `offering_id`, `week_number`, `title`, `topic`, `content`, `learning_objectives`, `preview_guide`, `review_guide`, `assignment_json`, `source_syllabus_id`, `source_reference`, `extraction_confidence`, `review_required`, `professor_confirmed`, timestamps다. `UNIQUE(offering_id, week_number)`가 중복 주차를 막는다.

| Draft JSON | 현재 DB 컬럼 | MVP 판단 |
| --- | --- | --- |
| `offeringId` | `offering_id` | 직접 FK 매핑 |
| `weekNumber` | `week_number` | 직접 매핑, 1~15 검증 |
| `title` | `title` | 직접 매핑 |
| `topics[]` | `topic` | 현재는 구분자로 정규화해 저장하되 원문 배열 보존이 필요하면 metadata JSONB에 저장 |
| `activityType` | 없음 | 승인본에 필요하면 `metadata.activity_type`; 장기적으로 명시 컬럼 후보 |
| `isAssessment` | 없음 | `metadata.is_assessment`; 평가 여부를 product query에서 필터링해야 하면 명시 컬럼 후보 |
| `sourceNote` | `source_reference` | source note와 출처 식별자를 구분해야 하므로 metadata 또는 별도 컬럼 권장 |
| `confidence` | `extraction_confidence` | high/medium/low를 임의 숫자로 바꾸지 않는다. 원 categorical 값은 metadata에 보존 |
| `source.syllabusId` | `source_syllabus_id` | 직접 FK 매핑 |
| `source.type` | 없음 | revision metadata의 `source_type` |
| `source.verifiedByProfessor` | `professor_confirmed` | 승인 transaction에서만 `true` |
| `warnings` | 없음 | 승인 기록의 review note/metadata에 보존; 학생 화면에는 자동 노출하지 않음 |

`content`, `learning_objectives`, guide 컬럼은 draft에 값이 없으므로 추측해서 채우지 않는다. `activityType`, `isAssessment`, categorical confidence, sourceNote를 학생 production 기능이 즉시 사용하지 않는다면 MVP에서 metadata JSONB로 보존하고, 검색·정렬·정책 조건이 필요해질 때 명시 컬럼 migration을 검토한다. 승인 상태·revision·승인자·승인 시각은 단순 metadata가 아니라 무결성 FK와 감사 조회가 필요하므로 별도 구조가 필요하다.

## 승인 transaction 의사 순서

실제 SQL은 다음 단계에서 작성한다. 모든 단계는 하나의 transaction 안에서 실행하며 오류 시 전체 rollback한다.

1. server action 진입 시 signed session을 읽고 `professor` role과 session expiry를 검증한다.
2. `profiles.id → professors.profile_id`로 현재 교수 row를 조회한다. client가 보낸 교수 ID는 무시한다.
3. offering을 `id`로 잠그고(`FOR UPDATE`), 담당 professor, course, term을 확인한다.
4. Git draft를 server-only loader로 읽고 schema, 15개 week, 순번, source, 상태를 다시 검증한다. `draft.status=draft`, `verifiedByProfessor=false`만 승인 대상으로 허용한다.
5. draft의 FK와 semester/term이 offering과 일치하는지 확인한다. 다른 offering의 draft, 누락 주차, 중복 주차, 이미 다른 교수 소유인 offering은 거부한다.
6. revision audit row를 `under_review` 또는 승인 직전 상태로 생성한다. `source_version`에는 파일 경로만이 아니라 내용 hash를 포함한다.
7. 기존 `approved` revision이 있으면 새 revision을 만들고 이전 revision을 `superseded`로 전환한다. 기존 current weekly rows는 offering/week unique key를 유지하는 원자적 upsert로 새 승인본으로 교체한다.
8. 1~15주를 모두 insert/upsert하고 `review_required=false`, `professor_confirmed=true`, source FK와 보존 metadata를 함께 기록한다. 한 주라도 실패하면 전체 rollback한다.
9. audit row에 `approved`, `approved_by`, `approved_at`, revision을 기록하고 transaction을 commit한다.
10. commit 후에만 approved badge와 학생 production 재조회가 가능하다. 재시도는 동일 source hash와 revision을 idempotency key로 사용해 중복 승인을 만들지 않는다.

## 보안 및 RLS

- service-role key는 현재처럼 server-only Supabase client에서만 사용하며 client bundle, props, URL, JSON response에 노출하지 않는다.
- 실제 승인 mutation은 server action 또는 동일한 server-only command 경로에서만 실행한다. 공개 API route는 만들지 않는다.
- role만 믿지 않고 `profiles → professors → course_offerings` 관계를 매번 DB에서 재검증한다.
- 현재 migration은 관련 테이블 RLS를 enable하고 `public`, `anon`, `authenticated` 권한을 revoke한다. 따라서 server-only 승인 구조를 유지하는 한 public RLS policy 추가는 필요하지 않다.
- 향후 browser가 직접 approved 데이터를 읽게 되면 `authenticated` 대상의 offering 소유/학생 배정 정책을 별도로 설계해야 한다. `TO authenticated`만으로 허용하지 않으며 소유 predicate와 `WITH CHECK`를 함께 둔다.
- `SECURITY DEFINER` 함수로 우회하지 않는다. 필요한 경우에도 비공개 schema, `auth.uid()` 검증, 최소 grant가 선행되어야 한다.

## UI 흐름 (설계만)

1. 교수 preview에서 draft 상태와 low confidence를 확인한다.
2. 교수는 수정 필요 메모를 남기거나 검토 완료를 선택한다.
3. 승인 전 확인 화면에서 offering, 주차 수, source version, 경고를 다시 표시한다.
4. 승인 성공 시 approved badge, 승인자/시각, revision을 표시한다.
5. 학생 화면은 별도 production 조회로 approved rows만 읽으며 draft를 자동 fallback하지 않는다.

이번 단계에서는 버튼, form, modal, toast, mutation을 구현하지 않는다.

## 재승인 및 rollback 정책

- 잘못된 승인 취소는 기존 approved row를 조용히 삭제하지 않고, 새 revision을 `rejected` 또는 `superseded`로 기록하는 방식으로 처리한다.
- 승인본 수정은 새 revision으로만 진행한다. 이전 revision과 source hash, 승인자, 메모를 보존한다.
- 학생에게 이미 노출된 승인본도 이력상 삭제하지 않는다. 새 revision 승인 후 current row만 교체하고, 필요하면 `superseded_by`로 연결한다.
- MVP 최소 범위는 담당 교수 승인, 15주 원자적 반영, unique offering/week, revision audit, approved-only student read다. 관리자 override, 부분 주차 승인, 학생별 개인화는 보류한다.

## 1-C-2D-B 구현 목록

다음 조건이 충족될 때만 진행한다.

- 승인 metadata/revision migration 설계가 확정됨
- 실제 Supabase 관계와 RLS 정책을 staging에서 검증함
- server-only 승인 command와 테스트가 준비됨
- 교수 승인/반려 문구와 audit retention 정책이 결정됨

예상 파일 목록:

- `src/services/weekly-plan-approval.server.ts`
- `src/services/weekly-plan-draft.server.ts` (승인 전용 validation 보강)
- `src/types/weekly-roadmap.ts` (상태·revision 타입)
- `supabase/migrations/<timestamp>_weekly_plan_approval.sql`
- `src/app/professor/weekly-plan-preview/page.tsx` (승인 UI는 별도 승인 후)
- 승인 transaction 및 권한 테스트 파일

현재 판단은 **1-C-2D-B 보류**다. 승인 audit/revision schema와 실제 인증 전환 방식이 아직 확정되지 않았고, 현재 draft loader의 상태 enum도 `draft|approved`에 한정되어 있다. 이 문서와 migration 후보를 검토·승인한 뒤에만 구현을 시작한다.
