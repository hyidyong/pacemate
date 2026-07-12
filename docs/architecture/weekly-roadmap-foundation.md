# 주간 로드맵 기반 설계

## 범위

이 문서는 0단계 DB 감사 결과를 반영한 1-A 설계 기록이다. 이번 단계에서는 로컬 migration 초안, TypeScript 계약, 서버 서비스 인터페이스만 추가한다. 원격 Supabase DB 적용, 기존 화면의 데이터 소스 전환, 기존 행 삭제는 1-A 범위가 아니다.

## 최종 데이터 모델

```text
academic_terms
  └─ course_offerings ── course_weekly_plans
          ├─ student_course_progress
          └─ student_weekly_progress
```

- `academic_terms`가 학기 시작일·종료일·타임존·주차 수의 기준이다.
- `course_offerings`는 같은 과목이 학기·분반·담당 교수에 따라 달라지는 수업 인스턴스다.
- `course_weekly_plans`는 강의계획서에서 추출·검수되는 주차별 콘텐츠다. 원본 `syllabi`와 출처 및 검수 상태를 함께 보존한다.
- `student_course_progress`는 수업 전체의 마지막 완료 주차와 요약 상태를 저장한다.
- `student_weekly_progress`는 주차별 상태 override, 난이도, 이해도, 개인 메모, 교수 공유 피드백, AI 가이드 메타데이터를 분리한다.

## 기존 테이블과의 연결

기존 행을 강제로 추정하지 않기 위해 다음 연결은 모두 nullable로 추가한다.

- `student_courses.offering_id`
- `chat_sessions.offering_id`
- `escalations.offering_id`
- `counseling_requests.offering_id`

기존 `course_id` 또는 `semester_label`만으로 offering을 임의 매핑하지 않는다. 1-C에서 실제 학생·교수 선택 흐름과 데이터 품질을 확인한 후 별도 backfill 정책을 승인받는다.

## 주차 계산 원칙

공식 주차는 `academic_terms.starts_on`과 `timezone`을 기준으로 서버에서 계산한다. 브라우저의 UTC `Date` 변환으로 날짜가 하루 밀리지 않도록 날짜 문자열 또는 학기 타임존 기준 계산을 사용한다. `student_courses.current_week`는 추가하지 않으며, 수업 진행 요약은 `student_course_progress.last_completed_week`와 현재 날짜 계산을 조합한다.

## 개인 메모와 교수 리포트 경계

`private_note`는 학생 개인 메모이며 교수용 조회 정책·리포트·view에 포함하지 않는다. 교수에게 공유할 수 있는 내용은 `shared_feedback`와 `share_feedback_with_professor = true`인 행으로 한정한다. `use_private_note_for_ai`는 향후 서버 측 AI 호출에서만 사용하고, 클라이언트 직접 조회 권한으로 확장하지 않는다.

## 질문·상담 연결

기존 `chat_sessions`, `escalations`, `counseling_requests`의 `offering_id`는 nullable이다. 기존 데이터는 그대로 유지하고 새 생성 흐름부터 offering을 기록한다. 기존 row를 자동으로 특정 수업에 연결하는 backfill은 하지 않는다.

## 인증과 RLS 방향

현재 앱은 `pacemate_profile_id` demo cookie를 사용하므로 이번 migration은 이를 RLS의 근거로 사용하지 않는다. 새 테이블은 `anon` 권한을 revoke하고, Supabase Auth 전환 이후 사용할 `authenticated` 정책만 초안으로 둔다. 학생 progress는 `auth.uid() = student_id`로 제한한다. 교수는 담당 offering의 weekly plan을 읽을 수 있지만 학생의 `private_note`에는 직접 권한을 주지 않는다.

Supabase Auth 전환 전에는 새 테이블을 호출하는 server-only 서비스가 세션의 profile id, role, 담당 offering을 별도로 검증해야 한다. service role 사용은 필요한 최소 함수 범위로만 제한하고 브라우저에 노출하지 않는다.

## 적용 순서와 rollback

1. migration SQL 정적 검토 및 staging에서 `EXPLAIN`/constraint 검증
2. 백업 확인 후 migration 적용
3. 실제 DB의 columns, constraints, indexes, RLS, grants 재조회
4. 1-C에서 서버 서비스 구현과 기존 dashboard 호출부 전환
5. 데이터 품질을 확인한 뒤에만 선택적 offering backfill 검토

이 migration은 additive 구조다. 문제가 생기면 새 테이블을 참조하는 애플리케이션 코드가 없는지 확인한 뒤, 승인된 rollback migration으로 새 constraint·index·table을 역순 제거한다. 원격 DB에서 임의 `DROP`, `TRUNCATE`, 기존 row `DELETE`를 실행하지 않는다.

## 1-C 전환 대상

- `src/app/dashboard/page.tsx`
- `src/components/roadmap/weekly-missions.tsx`
- `src/services/ai-tutor.actions.ts`

1-C에서 기존 `student_mission_progress`와 `student_courses.current_week` 호출을 새 서비스 계약으로 대체한다. 1-A에서는 이 파일들을 수정하지 않는다.
