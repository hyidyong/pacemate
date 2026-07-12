# PaceMate 마스터 로드맵

> 최종 갱신: 2026-07-12
> 
> 대상 프로젝트: `pacemate` (`szztsqdnvenfbgxtylkl`)

## 1. 프로젝트 목표

PaceMate는 학과별 Bluebook과 교육과정·졸업요건을 참고 데이터로 구조화하고, 학생의 입학연도와 이수 현황을 바탕으로 장기 로드맵을 제공하며, 교수 승인 주간계획과 학생 주간 진행 데이터를 안전하게 연결해 학기 말에는 익명 집계 기반 교수 리포트를 제공하는 학업 진행 지원 서비스다. 공식 졸업 판정은 학교 규정과 확인된 데이터가 충분히 검증된 뒤 별도 승인 범위에서만 다룬다.

## 2. 현재 지원 범위

현재 데이터·화면·시연의 지원 학과는 법학과와 전자공학과 두 곳뿐이다. 다른 학과의 Bluebook 변환, 데이터 seed, 온보딩 및 인수인계는 현재 범위에 포함하지 않는다.

| 구분 | 현재 범위 | 사용 목적 | 금지 또는 보류 |
| --- | --- | --- | --- |
| 법학과 | Bluebook 기반 46개 과목, 졸업요건·예외·진로 트랙 참고 데이터 | 법학 과목의 교수 주간계획 및 학기 리포트 시연, 진로 탐색 | 공식 졸업학점 계산, 학생에게 공식 졸업요건 자동 배정 |
| 전자공학과 | 이미지형 도식에서 확인한 41개 고유 과목, 47개 배치 | 학생 온보딩·장기 로드맵 시연의 중심 | 학점·정확한 학기·필수 여부가 확인되기 전 active 전환 및 공식 졸업 판정 |
| 학생 demo | 전자공학과 중심의 합성 학생 시나리오(후속 단계) | 온보딩, 이수 체크, 장기 로드맵 시연 | 실제 학생 데이터 변경, 합성 데이터를 production에 혼입 |
| 교수 demo | 기존 법학과 회사법·행정절차와행정구제 offering | 주간계획 preview 및 학기 리포트 시연 | 승인 mutation과 리포트 DB/seed는 별도 단계 전까지 미구현 |

## 3. 전체 데이터 흐름

```text
Bluebook
  → Curriculum DB
  → 학생 온보딩
  → 이수과목 선택
  → 장기 로드맵
  → 교수 승인 주간계획
  → 학생 주간 진행
  → 합성 시연 데이터
  → 교수 학기 리포트
```

각 화살표는 검증된 데이터 경계를 의미한다. Bluebook의 서술·도식은 참고 근거로만 사용하고, 공식 졸업 판정이나 법적 선수과목으로 추정하지 않는다. 승인되지 않은 주간 draft와 합성 demo 데이터는 학생 production 경로에서 분리한다.

## 4. 완료·진행·보류 현황

표기: `[x] 완료`, `[~] 진행 중`, `[ ] 미완료`, `[!] 보류 또는 확인 필요`

### 기반 및 주간 로드맵(1-C)

- [x] 1-C-0 기반 점검·인증·RLS·migration 준비 — 주간 로드맵 foundation 구조와 server-only 접근 경계를 확인했다. 관련: `supabase/migrations/20260712000000_weekly_roadmap_foundation.sql`, `docs/architecture/weekly-roadmap-generation-readiness.md`.
- [x] 1-C-1A/1-C-1B 2026-2 학기·개설강좌 입력 — `academic_terms` 1건과 `course_offerings` 2건이 실제 DB에 반영됐다. `student_courses` 연결은 0건으로 확정했다. 관련: `supabase/seed/2026-2-weekly-roadmap-foundation.sql`, `docs/architecture/2026-2-offering-seed-plan.md`.
- [x] 1-C-2A/1-C-2A-1 주차 draft 생성 — 회사법과 행정절차와행정구제 각각 1~15주 JSON draft를 생성했으며 교수 확인 전 상태다. 관련: `src/data/weekly-plans/2026-2-company-law.draft.json`, `src/data/weekly-plans/2026-2-administrative-procedure-remedies.draft.json`.
- [x] 1-C-2C 교수 read-only preview — 교수 역할에서만 draft를 읽고, 담당 offering 소유권으로 필터링하는 preview를 구현했다. 관련: `src/app/professor/weekly-plan-preview/page.tsx`, `src/services/weekly-plan-draft.server.ts`.
- [x] 1-C-2D-A 승인 workflow 설계 — draft, 검토, 승인, 재승인, rollback, server-only 보안과 DB 매핑을 문서화했다. 실제 승인 버튼·mutation은 아직 없다. 관련: `docs/architecture/weekly-plan-approval-workflow.md`.
- [!] 1-C-2D-B 승인 구현 — 교수 승인 mutation, `course_weekly_plans` 반영, 학생 노출은 승인 workflow와 후속 DB 설계 확인 전까지 보류한다.

### 교육과정·졸업요건(1-D)

- [x] 1-D-1 공통 schema 설계 — 법학과와 전자공학과를 수용하는 빈 공통 구조를 설계했다. 관련: `docs/architecture/curriculum-graduation-schema.md`, `docs/architecture/curriculum-onboarding-flow.md`.
- [x] 1-D-2A migration 초안 — curriculum/graduation 9개 테이블과 제약·RLS를 포함한 foundation migration을 작성했다.
- [x] 1-D-2B 안전성 검토 — FK/index/check/updated_at/RLS 및 demo 데이터 분리를 검토했다.
- [x] 1-D-2C 실제 적용 — 원격 DB에 `20260712120940_curriculum_graduation_foundation`이 단일 적용됐고 신규 테이블은 0건이다.
- [x] 1-D-2D migration history reconciliation — 로컬 파일을 원격 version `20260712120940`에 맞추고 재적용·repair 없이 정렬했다.
- [x] 1-D-3A 법학과 import 변환 — `src/data/curricula/law/2026.import.json`에 46개 과목, 3개 요건, 5개 예외, 11개 진로 트랙을 참고용으로 구조화했다.
- [x] 1-D-3B 법학과 정확성 검토 — exact course match 6개와 미매칭·학점·입학연도 불명확성을 분리하고 seed 전 확인 항목을 정리했다. 관련: `docs/architecture/law-curriculum-import-review.md`.
- [x] 1-D-4A/1-D-4A-1 전자공학과 이미지 도식 보정 — PDF 4쪽(인쇄 쪽수 3)의 이미지형 도식에서 41개 고유 과목을 추출했다.
- [x] 1-D-4B 전자공학과 정확성 검토 — exact DB match 0개, 학점·코드·정확한 학기·필수 여부 미확인, draft seed 가능/active 전환 보류로 확정했다. 관련: `docs/architecture/electronic-engineering-curriculum-import-review.md`.
- [x] 1-D-5A 전자공학과 draft seed SQL 작성 — 41개 과목과 참고 요건을 넣는 검토·재현용 SQL을 작성했지만 실행하지 않았다. 관련: `supabase/seed/2026-electronic-engineering-curriculum-draft.sql`.
- [x] 1-D-5B-0 admission year nullable migration 작성 — draft의 `admission_year_from/to` NULL을 허용하고 active의 시작연도 NULL을 차단하는 migration을 생성했다. 관련: `supabase/migrations/20260712134054_allow_null_admission_year_for_draft_curricula.sql`, `docs/architecture/curriculum-draft-admission-year-migration-review.md`.
- [x] 1-D-5B-1 migration 안전성 검토 — preflight, constraint, partial unique index, 기존 데이터 불변성을 확인했다.
- [x] 1-D-5B-2 migration 실제 DB 적용 — 원격에 단일 적용 후 nullable·constraint·index·RLS를 read-only 검증했다.
- [x] 1-D-5C 전자공학과 draft seed 적용 — department reference seed 이후 draft version 1건, 과목 41개, requirement 12개, exception 8개를 반영하고 안전 invariant를 검증했다.
- [x] 1-D-5D 법학과 참고용 draft seed — 원격 read-only 검증을 완료했다. `law-bluebook-reference-unknown` draft는 46개 과목(정확 매칭 6, 미해결 40), requirement 3개, exception 5개, career track 11개와 저장된 career link 118개를 유지한다. 원문 career link 123개 중 localKey 미확정 5개는 보류했다. active 전환·학생 배정·공식 졸업 계산은 금지 상태다. 관련: `docs/architecture/law-curriculum-import-review.md`, `supabase/seed/2026-law-curriculum-draft.sql`.
- [!] 공식 졸업 계산 — 학점·입학연도·필수 여부·학교 공통 규정이 확정되기 전까지 학생에게 공식 판정을 제공하지 않는다.

## 5. 현재 단계: 1-D-5D 완료

### 목적

전자공학과 이미지 도식 기반 draft curriculum을 실제 DB에 참고용으로 저장했다. `sourceAcademicYear=2026`은 원본 자료 연도이며, 학생 입학연도 적용 범위와 동일하다고 추정하지 않는다.

### 입력과 완료 조건

- 새 migration 1개를 Supabase CLI로 생성했다: `20260712134054_allow_null_admission_year_for_draft_curricula.sql`.
- draft는 `admission_year_from`이 NULL이어도 저장할 수 있어야 한다.
- active는 `admission_year_from`이 NULL이면 저장할 수 없어야 한다.
- 기존 `20260712120940_curriculum_graduation_foundation.sql`은 변경하지 않는다.
- 전자공학과 검토용 seed SQL은 NULL 범위를 사용하도록 정리돼 있다.
- migration과 draft seed 적용 후 원격 read-only 검증을 완료했다.

### 금지 범위

이 단계에서는 원격 DB 변경, migration push/up/repair, curriculum seed, 학생 데이터·course catalog 변경, UI·서비스 코드 수정, demo/semester report 데이터 입력, commit/push를 하지 않는다.

## 6. 다음 개발 순서

총 7개 개발 Phase를 A부터 G까지 순서대로 진행한다. 각 단계의 승인 조건을 충족하기 전에는 다음 단계의 DB 입력이나 학생 노출을 시작하지 않는다.

### Phase A — Curriculum Draft 저장

- [x] 1-D-5B-0 admission year nullable migration 작성
- [x] 1-D-5B-1 migration 안전성 검토
- [x] 1-D-5B-2 migration 실제 DB 적용
- [x] 1-D-5C 전자공학과 draft seed 실제 적용
- [x] 1-D-5D 법학과 참고용 draft seed 작성·적용 및 read-only 검증

### Phase B — 학생 온보딩·장기 로드맵

- [ ] 1-D-6 curriculum 조회 service
- [ ] 1-D-7 학과·입학연도 선택
- [ ] 1-D-8 이수 완료·학점 인정 과목 체크 UI
- [ ] 2-A 전자공학과 장기 로드맵
- [ ] 2-B 남은 과목·권장 흐름 계산
- [ ] 2-C 참고용 졸업 진행률(공식 판정 아님)

입학연도와 과목 매칭이 검증되기 전까지 공식 졸업 가능 여부를 표시하지 않는다.

### Phase C — 교수 승인 주간계획

- [ ] 3-A 주간계획 draft/approved DB 구조
- [ ] 3-B 교수 수정·승인 server action
- [ ] 3-C approved 주간계획만 학생에게 노출
- [ ] 3-D 학생과 offering 연결

### Phase D — 학생 주간 진행

- [ ] 4-A 주차 완료 상태
- [ ] 4-B 이해도 1~5
- [ ] 4-C 난이도 1~5
- [ ] 4-D 학습 시간
- [ ] 4-E 도움이 필요한지
- [ ] 4-F 주간 피드백

### Phase E — 합성 시연 데이터

- [ ] 5-A 전자공학과 합성 학생
- [ ] 5-B 법학과 과목 리포트용 합성 학생
- [ ] 5-C 15주 진행 데이터
- [ ] 5-D `source_batch`와 `is_demo` 표시
- [ ] 5-E cleanup SQL

합성 데이터는 별도 migration/seed와 명시적 demo 경계를 사용하며 production seed에 섞지 않는다.

### Phase F — 교수 학기 리포트

- [ ] 6-A `semester_reports` schema
- [ ] 6-B `academic_terms.ends_on` 기반 생성 가능 조건
- [ ] 6-C 담당 교수 권한 검증
- [ ] 6-D 익명 집계와 최소 그룹 크기
- [ ] 6-E 주차별 진행·이해도·난이도 집계
- [ ] 6-F report snapshot
- [ ] 6-G 리포트 생성 버튼
- [ ] 6-H `generating` 상태
- [ ] 6-I 앱 내부 알림
- [ ] 6-J 리포트 UI
- [ ] 6-K PDF/공유 요약(후속)

### Phase G — 디자인·최종 데모

- [ ] 학생 온보딩 디자인
- [ ] 장기 로드맵 디자인
- [ ] 주간 로드맵 디자인
- [ ] 교수 승인 디자인
- [ ] 학기 리포트 디자인
- [ ] 학기 말 생성 시뮬레이션
- [ ] 반응형 QA
- [ ] 최종 발표 흐름

## 7. 학과별 정책

### 법학과

- Bluebook과 import JSON은 참고용 교육과정·진로 데이터다.
- 로스쿨/변호사시험, 법무사, 공무원 등 문서에 근거한 진로 탐색과 교수 demo는 허용한다.
- 공식 졸업학점 계산, 공식 졸업요건 자동 배정, 법적 선수과목 추정은 금지한다.
- 회사법과 행정절차와행정구제는 교수 주간계획 및 학기 리포트 시연에 사용할 수 있다.

### 전자공학과

- 학생 온보딩과 장기 로드맵 demo의 중심 학과다.
- 이미지 도식에서 확인된 41개 과목을 draft로 체크할 수 있다.
- 학년 흐름은 참고용으로 표시할 수 있으나, 학점·정확한 학기·필수 여부가 확인되지 않은 상태에서는 공식 계산에 사용하지 않는다.
- 합성 데이터 기반 참고 진행률은 허용하지만 공식 졸업 가능 여부는 표시하지 않는다.

## 8. 교수 학기 리포트 흐름

```text
학기 진행 중
  → academic_terms.ends_on 경과
  → 리포트 생성 가능
  → 담당 교수 생성 버튼 클릭
  → generating
  → ready
  → 앱 내부 알림
  → 리포트 열람
```

실제 학기의 `starts_on`·`ends_on`은 demo를 위해 변경하지 않는다. demo 계정에서는 별도 시나리오 상태로 생성 가능 조건을 충족시키고, 실제 교수 소유 offering과 서버 측 권한을 다시 검증한다. 리포트에는 학생 이름·이메일·학번을 포함하지 않고 최소 그룹 크기 미달 집계는 노출하지 않는다.

## 9. 공통 안전 규칙

1. schema migration, 실제 curriculum seed, 합성 demo seed는 서로 다른 파일과 실행 단계로 분리한다.
2. service-role key는 서버 전용으로 유지하고 client에 전달하지 않는다.
3. 합성 학생·진행 데이터는 `is_demo`와 `source_batch`로 표시하고 production 경로에서 필터링한다.
4. 법학과와 전자공학과 어느 쪽도 검증 전 공식 졸업 판정에 사용하지 않는다.
5. PDF에 없는 학점·필수 여부·선수과목·입학연도 적용 범위를 추측하지 않는다.
6. `course_id` NULL은 draft 단계에서 허용하되 active 전환 전에 exact match를 검증한다.
7. active curriculum은 입학연도 시작값과 유효한 범위를 가져야 한다.
8. 승인되지 않은 weekly draft는 학생 production 조회에서 제외한다.
9. 교수 리포트는 익명 집계와 최소 그룹 크기를 적용하며 개인 식별 정보를 저장·표시하지 않는다.
10. 각 단계는 사전 검토와 사후 검증이 끝난 뒤에만 다음 단계로 넘긴다.

## 10. 현재 게이트와 권장 다음 행동

| 순서 | 게이트 | 통과 조건 |
| --- | --- | --- |
| 1 | 1-D-5B-1 migration 안전성 검토 | 기존 migration 불변, active NULL 차단, draft NULL 허용, RLS/권한 변화 없음 |
| 2 | 1-D-5B-2 migration 적용 | 원격 프로젝트·migration history 확인 후 단일 적용, rollback 계획 확보 |
| 3 | 1-D-5C 전자공학 draft seed | department FK·41개 course draft·요건 count·중복 방지 검증 |
| 4 | 1-D-5D 법학 참고 seed | exact course match와 source page를 재검토하고 공식 요건과 분리 |
| 5 | 1-D-6 이후 학생 기능 | draft 조회 정책, 입학연도 선택, course matching 정책 확정 |
| 6 | 3-A 이후 weekly approval | 승인본만 production에 노출되는 transaction과 소유권 검증 구현 |
| 7 | Phase E/F | 별도 demo seed와 `semester_reports` schema를 검토·적용한 뒤 익명 리포트 시연 |

현재 즉시 진행 가능한 다음 단계는 1-D-6 curriculum 조회 service이며, 법학과·전자공학과의 active 전환·학생 배정·공식 졸업 계산은 보류한다.

## 11. 관련 산출물

- [교육과정·졸업요건 schema](../architecture/curriculum-graduation-schema.md)
- [입학연도 nullable migration 검토](../architecture/curriculum-draft-admission-year-migration-review.md)
- [전자공학과 import 검토](../architecture/electronic-engineering-curriculum-import-review.md)
- [전자공학과 draft seed 검토](../architecture/electronic-engineering-draft-seed-review.md)
- [법학과 import 검토](../architecture/law-curriculum-import-review.md)
- [주간계획 생성 readiness](../architecture/weekly-roadmap-generation-readiness.md)
- [주간계획 승인 workflow](../architecture/weekly-plan-approval-workflow.md)
- [주간계획 draft review](../architecture/weekly-plan-draft-review.md)
- [전자공학과 import JSON](../../src/data/curricula/electronic-engineering/2026.import.json)
- [법학과 import JSON](../../src/data/curricula/law/2026.import.json)

## 12. 새 대화 인계 요약

다음 대화에서는 아래 상태를 그대로 이어서 사용한다.

1. PaceMate 현재 지원 학과는 법학과와 전자공학과다.
2. 법학과는 참고용 Bluebook import와 교수 demo 근거가 있다.
3. 전자공학과는 이미지 도식에서 41개 고유 과목을 추출했다.
4. 전자공학과 과목의 courseId는 현재 exact match가 0개다.
5. 전자공학과의 학점·과목코드·정확한 학기·필수 여부는 미확인이다.
6. curriculum/graduation foundation migration은 원격에 20260712120940으로 적용됐다.
7. 신규 curriculum/graduation 테이블은 현재 0건이다.
8. 로컬 migration history는 원격 version과 정렬돼 있다.
9. 20260712134054 migration은 원격에 적용됐고 read-only 검증됐다.
10. 전자공학과 department reference row 1건이 생성됐다.
11. 전자공학과 draft curriculum version 1건이 저장됐다.
12. 전자공학과 draft 과목 41개, requirement 12개, exception 8개가 검증됐다.
13. admission year 두 값은 NULL이고 `source_verified=false`다.
14. course_id·credits·recommended_semester는 모두 NULL이고 `is_required=false`다.
15. active curriculum, student assignment, electronic course catalog row는 생성되지 않았다.
16. curriculum 관련 RLS는 활성이고 policy와 anon/authenticated grant는 없다.
17. 현재 다음 단계는 1-D-6 curriculum 조회 service다.
18. 법학과 참고용 seed는 전자공학과 seed와 분리된 1-D-5D다.
19. `course_id` NULL은 draft에서 허용하고 active에서 exact match를 재검증한다.
20. 공식 졸업 판정은 두 학과 모두 보류 상태다.
21. student onboarding과 장기 로드맵은 Phase B의 후속 작업이다.
22. 교수 weekly draft preview는 server-only이며 담당 offering 소유권 필터가 있다.
23. 교수 승인 mutation과 approved DB 반영은 아직 구현하지 않았다.
24. `course_weekly_plans`에는 승인된 주차 데이터가 아직 없다.
25. 2026-2 term과 법학과 offering 2건은 실제 DB에 존재한다.
26. 법학과 student_courses offering 연결은 0건이다.
27. 합성 학생·주간 진행 데이터는 별도 demo seed로 관리해야 한다.
28. `semester_reports` schema와 report demo 데이터는 아직 별도 작업이다.
29. 리포트는 학기 종료 후 담당 교수만 생성하고 익명 집계한다.
30. 실제 academic_terms 날짜를 demo 때문에 변경하지 않는다.
31. 학생 production에는 승인된 계획과 비-demo 데이터만 노출한다.
32. DB·migration·seed·UI 변경은 각 단계의 명시적 승인 후에만 수행한다.
33. 이번 마스터 로드맵 작성에서는 DB 변경, seed 실행, commit/push를 하지 않았다.

## 13. 2026-2 교수 demo 연결 정책

- 회사법만 교수 weekly plan 승인 및 학기 리포트 live demo 대상이다.
- 행정절차와행정구제는 weekly plan 데이터 구조 확인용으로 유지하며, 로그인 교수 연결은 보류한다.
- 정식 운영에서는 실제 교수 계정별로 각 담당 교수 row와 offering을 별도로 연결해야 한다.
- 연결 reference seed는 `supabase/seed/2026-demo-professor-offering-link.sql`에 분리하고, migration·auth user 생성·학생/weekly plan/curriculum/report 데이터 생성과 구분한다.
